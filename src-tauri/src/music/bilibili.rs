use super::{MusicSource, UnifiedSong, PlayUrlResult, SearchResult};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;

pub struct BilibiliMusic {
    client: Client,
}

impl BilibiliMusic {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client }
    }
}

#[async_trait]
impl MusicSource for BilibiliMusic {
    fn name(&self) -> &str {
        "bilibili"
    }

    async fn search(&self, keyword: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult> {
        // B站音频搜索（音频区 = audio 区）
        let keyword_encoded = urlencoding::encode(keyword);
        let url = format!(
            "https://api.bilibili.com/x/web-interface/search/type?search_type=audio&keyword={}&page={}&page_size={}",
            keyword_encoded,
            page,
            page_size
        );

        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;

        // 🆕 B站搜索接口已启用风控（无 Wbi 签名/风控 Cookie 时返回 -412 或空结果），
        //    给出明确提示，由上层降级到其他平台。
        if json.get("code").and_then(|v| v.as_i64()) == Some(-412) {
            anyhow::bail!("B站：搜索接口触发风控校验，暂不可用（可换源搜索）");
        }

        let data = json.get("data").cloned().unwrap_or_default();
        let total = data.get("numResults").and_then(|v| v.as_u64()).unwrap_or(0);

        let results = data.get("result")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut songs = Vec::new();
        for item in results {
            let bvid = item.get("bvid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = item.get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("未知")
                .to_string()
                .replace("<em class=\"keyword\">", "")
                .replace("</em>", "");

            let author = item.get("author")
                .and_then(|v| v.as_str())
                .unwrap_or("未知")
                .to_string();

            let duration_str = item.get("duration")
                .and_then(|v| v.as_str())
                .unwrap_or("0:00")
                .to_string();

            // 解析 "m:ss" 格式
            let parts: Vec<&str> = duration_str.split(':').collect();
            let duration = if parts.len() == 2 {
                let mins: u64 = parts[0].parse().unwrap_or(0);
                let secs: u64 = parts[1].parse().unwrap_or(0);
                mins * 60 + secs
            } else {
                0
            };

            let cover = item.get("pic")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| {
                    let url = s.replace("http://", "https://");
                    if url.starts_with("//") {
                        format!("https:{}", url)
                    } else {
                        url
                    }
                });

            // BV号作为ID（后续获取播放URL时需要转换为音频CID）
            songs.push(UnifiedSong {
                id: bvid,
                title,
                artist: author,
                album: None,
                duration,
                platform: "bilibili".to_string(),
                cover,
                lyrics: None,
            });
        }

        Ok(SearchResult {
            songs,
            has_more: ((page * page_size) as u64) < total,
            total,
        })
    }

    async fn get_play_url(&self, song_id: &str) -> anyhow::Result<PlayUrlResult> {
        // 第一步：通过 BV号获取音频 CID
        let video_info_url = format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            song_id
        );

        let resp = self.client.get(&video_info_url).send().await?;
        let json: Value = resp.json().await?;

        let cid = json.get("data")
            .and_then(|v| v.get("cid"))
            .and_then(|v| v.as_i64())
            .ok_or_else(|| anyhow::anyhow!("B站：无法获取音频CID"))?;

        let aid = json.get("data")
            .and_then(|v| v.get("aid"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // 第二步：获取音频播放URL
        let play_url = format!(
            "https://api.bilibili.com/x/player/playurl?avid={}&cid={}&fnval=16&qn=64",
            aid, cid
        );

        let resp = self.client.get(&play_url).send().await?;
        let json: Value = resp.json().await?;

        // 尝试从 DASH 格式获取音频流
        if let Some(dash) = json.get("data").and_then(|v| v.get("dash")) {
            if let Some(audio_arr) = dash.get("audio").and_then(|v| v.as_array()) {
                if let Some(audio) = audio_arr.first() {
                    let url = audio.get("baseUrl")
                        .or_else(|| audio.get("base_url"))
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow::anyhow!("B站：音频URL为空"))?
                        .to_string();

                    let bandwidth = audio.get("bandwidth").and_then(|v| v.as_u64()).unwrap_or(0);
                    let quality = format!("{}kbps", bandwidth / 1000);

                    // B站音频需要 Referer
                    return Ok(PlayUrlResult {
                        url,
                        quality,
                        format: "m4a".to_string(),
                        file_size: audio.get("size").and_then(|v| v.as_u64()),
                        needs_proxy: false,
                        fallback_urls: vec![],
                    });
                }
            }
        }

        // 降级：尝试从 durl 获取
        if let Some(durl_arr) = json.get("data")
            .and_then(|v| v.get("durl"))
            .and_then(|v| v.as_array())
        {
            if let Some(durl) = durl_arr.first() {
                let url = durl.get("url")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("B站：URL为空"))?
                    .to_string();

                return Ok(PlayUrlResult {
                    url,
                    quality: "64kbps".to_string(),
                    format: "flv".to_string(),
                    file_size: durl.get("size").and_then(|v| v.as_u64()),
                    needs_proxy: false,
                    fallback_urls: vec![],
                });
            }
        }

        anyhow::bail!("B站：无法获取播放URL")
    }

    async fn get_lyrics(&self, _song_id: &str) -> anyhow::Result<Option<String>> {
        // B站大部分视频/音频无标准歌词
        Ok(None)
    }

    async fn get_cover(&self, song_id: &str, _album_id: Option<&str>) -> anyhow::Result<Option<String>> {
        let url = format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            song_id
        );

        let resp = self.client.get(&url).send().await?;
        let json: Value = resp.json().await?;

        let cover = json.get("data")
            .and_then(|v| v.get("pic"))
            .and_then(|v| v.as_str())
            .map(|s| {
                let url = s.replace("http://", "https://");
                if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                }
            });

        Ok(cover)
    }
}
