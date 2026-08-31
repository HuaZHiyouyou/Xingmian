use super::{MusicSource, UnifiedSong, PlayUrlResult, SearchResult};
use async_trait::async_trait;
use serde::Deserialize;

pub struct KuwoMusic {
    client: reqwest::Client,
}

impl KuwoMusic {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { client }
    }

    /// 获取酷我 CSRF token 和 cookie
    async fn get_csrf_token(&self) -> anyhow::Result<(String, String)> {
        let resp = self.client
            .get("http://www.kuwo.cn/")
            .send()
            .await?;

        let mut kw_token = String::new();
        let mut cookie_str = String::new();
        for cookie in resp.cookies() {
            if cookie.name() == "kw_token" {
                kw_token = cookie.value().to_string();
            }
            if !cookie_str.is_empty() {
                cookie_str.push_str("; ");
            }
            cookie_str.push_str(&format!("{}={}", cookie.name(), cookie.value()));
        }

        if kw_token.is_empty() {
            kw_token = "C1TQXN4L".to_string();
        }

        Ok((kw_token, cookie_str))
    }
}

#[derive(Debug, Deserialize)]
struct KuwoSearchResponse {
    status: Option<i32>,
    data: Option<KuwoSearchData>,
    msg: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KuwoSearchData {
    list: Option<Vec<KuwoSong>>,
    total: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct KuwoSong {
    rid: Option<u64>,
    name: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    pic: Option<String>,
    duration: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct KuwoPlayUrlResponse {
    data: Option<KuwoPlayData>,
}

#[derive(Debug, Deserialize)]
struct KuwoPlayData {
    url: Option<String>,
    format: Option<String>,
    br: Option<u32>,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct KuwoLyricsResponse {
    data: Option<KuwoLyricsData>,
}

#[derive(Debug, Deserialize)]
struct KuwoLyricsData {
    lrclist: Option<Vec<KuwoLyricLine>>,
}

#[derive(Debug, Deserialize)]
struct KuwoLyricLine {
    time: Option<String>,
    line_lyric: Option<String>,
}

#[async_trait]
impl MusicSource for KuwoMusic {
    fn name(&self) -> &str {
        "kuwo"
    }

    async fn search(&self, keyword: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult> {
        let (csrf_token, cookie_str) = self.get_csrf_token().await?;
        log::debug!("[Kuwo] csrf_token: {}", csrf_token);

        let req_id = uuid::Uuid::new_v4();
        let url = format!(
            "http://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key={}&pn={}&rn={}&httpsStatus=1&reqId={}",
            keyword, page, page_size, req_id
        );

        let resp = self.client
            .get(&url)
            .header("Cookie", &cookie_str)
            .header("csrf", &csrf_token)
            .header("Referer", "http://www.kuwo.cn/")
            .send()
            .await?;

        let body = resp.text().await?;
        log::debug!("[Kuwo] search raw response: {}", &body[..body.len().min(500)]);

        let search_resp: KuwoSearchResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        if let Some(status) = search_resp.status {
            if status != 200 {
                // 🆕 酷我 Web API 已加 secret 签名校验（实测返回 "The request is illegal!"）
                let msg = search_resp.msg.unwrap_or_default();
                if msg.contains("illegal") {
                    return Err(anyhow::anyhow!("酷我：官方接口需要签名校验，暂不可用（可换源搜索）"));
                }
                return Err(anyhow::anyhow!("Kuwo API error: {}", msg));
            }
        }

        let data = search_resp.data.ok_or_else(|| anyhow::anyhow!("No data field"))?;
        let total = data.total.unwrap_or(0);
        let songs = data.list.unwrap_or_default();

        let mut unified_songs = Vec::new();
        for song in songs {
            let rid = song.rid.unwrap_or(0);
            if rid == 0 { continue; }

            let duration = song.duration.unwrap_or(0) / 1000;
            let cover = song.pic.map(|p| {
                if p.starts_with("//") { format!("https:{}", p) } else { p }
            });

            unified_songs.push(UnifiedSong {
                id: rid.to_string(),
                title: song.name.unwrap_or_default(),
                artist: song.artist.unwrap_or_else(|| "未知艺术家".to_string()),
                album: song.album,
                duration,
                platform: "kuwo".to_string(),
                cover,
                lyrics: None,
            });
        }

        Ok(SearchResult {
            songs: unified_songs,
            has_more: ((page * page_size) as u64) < total,
            total,
        })
    }

    async fn get_play_url(&self, song_id: &str) -> anyhow::Result<PlayUrlResult> {
        let (csrf_token, cookie_str) = self.get_csrf_token().await?;
        let req_id = uuid::Uuid::new_v4();

        // 方案1: 新版API
        let url = format!(
            "http://www.kuwo.cn/api/v1/www/music/playUrl?mid={}&type=music&httpsStatus=1&reqId={}",
            song_id, req_id
        );

        let resp = self.client
            .get(&url)
            .header("Cookie", &cookie_str)
            .header("csrf", &csrf_token)
            .header("Referer", "http://www.kuwo.cn/")
            .send()
            .await?;

        let body = resp.text().await?;
        let play_resp: KuwoPlayUrlResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        if let Some(data) = play_resp.data {
            if let Some(url) = data.url {
                return Ok(PlayUrlResult {
                    url,
                    quality: format!("{}kbps", data.br.unwrap_or(320)),
                    format: data.format.unwrap_or_else(|| "mp3".to_string()),
                    file_size: data.size,
                    needs_proxy: false,
                    fallback_urls: vec![],
                });
            }
        }

        // 方案2: 旧版 antiserver
        let old_url = format!(
            "http://antiserver.kuwo.cn/anti.s?type=convert_url3&rid={}&format=mp3&response=url",
            song_id
        );
        let resp = self.client.get(&old_url).send().await?;
        let play_url = resp.text().await?.trim().to_string();

        if !play_url.is_empty() && play_url.starts_with("http") {
            return Ok(PlayUrlResult {
                url: play_url,
                quality: "320kbps".to_string(),
                format: "mp3".to_string(),
                file_size: None,
                needs_proxy: false,
                fallback_urls: vec![],
            });
        }

        anyhow::bail!("酷我：无法获取播放链接")
    }

    async fn get_lyrics(&self, song_id: &str) -> anyhow::Result<Option<String>> {
        let url = format!(
            "http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId={}",
            song_id
        );

        let resp = self.client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)")
            .send()
            .await?;

        let body = resp.text().await?;
        let lyrics_resp: KuwoLyricsResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow::anyhow!("JSON parse error: {}", e))?;

        if let Some(data) = lyrics_resp.data {
            if let Some(lrclist) = data.lrclist {
                let mut lyrics = String::new();
                for line in lrclist {
                    if let (Some(time), Some(text)) = (line.time, line.line_lyric) {
                        if let Ok(secs) = time.parse::<f64>() {
                            let mins = (secs / 60.0) as u32;
                            let remain_secs = secs % 60.0;
                            lyrics.push_str(&format!(
                                "[{:02}:{:05.2}]{}\n",
                                mins, remain_secs, text
                            ));
                        }
                    }
                }
                if !lyrics.is_empty() {
                    return Ok(Some(lyrics));
                }
            }
        }
        Ok(None)
    }

    async fn get_cover(&self, _song_id: &str, _album_id: Option<&str>) -> anyhow::Result<Option<String>> {
        // 酷我搜索结果中已包含封面URL
        Ok(None)
    }
}
