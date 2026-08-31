use super::{MusicSource, PlayUrlResult, SearchResult, UnifiedSong};
use async_trait::async_trait;
use serde_json::Value;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub struct KuGouMusic {
    client: reqwest::Client,
}

impl KuGouMusic {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client }
    }

    async fn get_json(&self, url: &str, params: &[(&str, &str)]) -> anyhow::Result<Value> {
        let response = self.client
            .get(url)
            .query(params)
            .header("Referer", "https://www.kugou.com/")
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }
}

#[async_trait]
impl MusicSource for KuGouMusic {
    fn name(&self) -> &str {
        "kugou"
    }

    async fn search(&self, keyword: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult> {
        // 🆕 修复：complexsearch.kugou.com 已加签名校验（实测返回 status=0/total=0），
        //    改用官方旧版 Web 搜索端点 songsearch.kugou.com/song_search_v2（实测可用），
        //    失败时回退 complexsearch 兼容。
        let page_num = page.max(1);
        let size = page_size.clamp(1, 50);
        let page_str = page_num.to_string();
        let size_str = size.to_string();

        let body = match self.get_json(
            "https://songsearch.kugou.com/song_search_v2",
            &[("keyword", keyword), ("page", &page_str), ("pagesize", &size_str)],
        ).await {
            Ok(b) => b,
            Err(e) => {
                log::warn!("[Kugou] song_search_v2 失败，回退 complexsearch: {}", e);
                self.get_json(
                    "https://complexsearch.kugou.com/v2/search/song",
                    &[("keyword", keyword), ("page", &page_str), ("pagesize", &size_str), ("platform", "WebFilter")],
                ).await?
            }
        };
        let data = &body["data"];
        let total = data["total"].as_u64().unwrap_or(0);
        let songs = data["lists"].as_array().cloned().unwrap_or_default().into_iter().filter_map(|song| {
            let hash = song["FileHash"].as_str().filter(|hash| !hash.is_empty())?.to_string();
            let title = song["SongName"].as_str().unwrap_or_default().replace("<em>", "").replace("</em>", "");
            let artist = song["SingerName"].as_str().unwrap_or("未知艺术家").to_string();
            let album = song["AlbumName"].as_str().map(ToString::to_string);
            let album_id = song["AlbumID"].as_str().unwrap_or_default();
            let duration = song["Duration"].as_u64().unwrap_or(0);
            Some(UnifiedSong {
                id: hash,
                title,
                artist,
                album,
                duration,
                platform: self.name().to_string(),
                cover: (!album_id.is_empty()).then(|| format!("https://imge.kugou.com/stdmusic/{}/{}", &album_id[..album_id.len().min(2)], album_id)),
                lyrics: None,
            })
        }).collect();

        Ok(SearchResult {
            songs,
            has_more: page_num.saturating_mul(size) < total as u32,
            total,
        })
    }

    async fn get_play_url(&self, song_id: &str) -> anyhow::Result<PlayUrlResult> {
        // 🆕 酷狗 Web 播放接口已全面要求签名校验（实测 err_code=30020），
        //    官方渠道无法在无登录态下取流。给出明确错误，由上层多源降级处理。
        let _ = song_id;
        anyhow::bail!("酷狗音乐：官方接口需要签名/登录校验，暂无法获取播放地址（可换源搜索）")
    }

    async fn get_lyrics(&self, song_id: &str) -> anyhow::Result<Option<String>> {
        let body = self.get_json(
            "https://www.kugou.com/yy/index.php",
            &[("r", "play/getdata"), ("hash", song_id)],
        ).await?;
        Ok(body["data"]["lyrics"].as_str().map(ToString::to_string).or_else(|| body["data"]["lyrics"].as_array().and_then(|lines| {
            let text = lines.iter().filter_map(|line| line.as_str()).collect::<Vec<_>>().join("\n");
            (!text.is_empty()).then_some(text)
        })))
    }

    async fn get_cover(&self, _song_id: &str, album_id: Option<&str>) -> anyhow::Result<Option<String>> {
        Ok(album_id.filter(|id| !id.is_empty()).map(|id| format!("https://imge.kugou.com/stdmusic/{}/{}", &id[..id.len().min(2)], id)))
    }
}
