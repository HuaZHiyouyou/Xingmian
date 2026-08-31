use super::{MusicSource, PlayUrlResult, SearchResult, UnifiedSong};
use async_trait::async_trait;
use serde_json::{json, Value};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const GUID: &str = "10000";

pub struct QqMusic {
    client: reqwest::Client,
}

impl QqMusic {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client }
    }

    async fn request_musicu(&self, payload: Value) -> anyhow::Result<Value> {
        let response = self.client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/")
            .json(&payload)
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }

    fn image_url(mid: &str) -> Option<String> {
        (!mid.is_empty()).then(|| format!("https://y.gtimg.cn/music/photo_new/T002R300x300M000{mid}.jpg"))
    }
}

#[async_trait]
impl MusicSource for QqMusic {
    fn name(&self) -> &str {
        "qq"
    }

    async fn search(&self, keyword: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 50);
        let payload = json!({
            "req_1": {
                "module": "music.search.SearchCgiService",
                "method": "DoSearchForQQMusicDesktop",
                "param": {
                    "query": keyword,
                    "page_num": page,
                    "num_per_page": page_size,
                    "search_type": 0
                }
            }
        });
        let body = self.request_musicu(payload).await?;
        let data = &body["req_1"]["data"]["body"]["song"];
        let total = data["totalnum"].as_u64().unwrap_or(0);
        let songs = data["list"].as_array().cloned().unwrap_or_default().into_iter().filter_map(|song| {
            let mid = song["mid"].as_str()?.to_string();
            let title = song["name"].as_str().unwrap_or_default().to_string();
            let artist = song["singer"].as_array()
                .map(|singers| singers.iter().filter_map(|singer| singer["name"].as_str()).collect::<Vec<_>>().join("、"))
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "未知艺术家".to_string());
            let album = song["album"]["name"].as_str().map(ToString::to_string);
            let album_mid = song["album"]["mid"].as_str().unwrap_or_default();
            Some(UnifiedSong {
                id: mid,
                title,
                artist,
                album,
                duration: song["interval"].as_u64().unwrap_or(0),
                platform: self.name().to_string(),
                cover: Self::image_url(album_mid),
                lyrics: None,
            })
        }).collect();

        Ok(SearchResult {
            songs,
            has_more: page.saturating_mul(page_size) < total as u32,
            total,
        })
    }

    async fn get_play_url(&self, song_id: &str) -> anyhow::Result<PlayUrlResult> {
        let payload = json!({
            "req_0": {
                "module": "vkey.GetVkeyServer",
                "method": "CgiGetVkey",
                "param": {
                    "guid": GUID,
                    "songmid": [song_id],
                    "songtype": [0],
                    "uin": "0",
                    "loginflag": 1,
                    "platform": "20"
                }
            }
        });
        let body = self.request_musicu(payload).await?;
        let item = body["req_0"]["data"]["midurlinfo"].as_array().and_then(|items| items.first())
            .ok_or_else(|| anyhow::anyhow!("QQ音乐：未返回播放地址"))?;
        let purl = item["purl"].as_str().unwrap_or_default();
        if purl.is_empty() {
            // 🆕 实测：官方 vkey 接口对未登录（uin=0）请求大量返回空 purl（会员/登录校验）
            anyhow::bail!("QQ音乐：该歌曲需要会员或登录（官方限制），可换源搜索")
        }
        Ok(PlayUrlResult {
            url: format!("https://isure.stream.qqmusic.qq.com/{purl}"),
            quality: "标准".to_string(),
            format: purl.rsplit('.').next().unwrap_or("m4a").to_string(),
            file_size: item["filesize"].as_u64(),
            needs_proxy: false,
            fallback_urls: vec![],
        })
    }

    async fn get_lyrics(&self, song_id: &str) -> anyhow::Result<Option<String>> {
        let response = self.client
            .get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg")
            .query(&[("songmid", song_id), ("format", "json"), ("nobase64", "1")])
            .header("Referer", "https://y.qq.com/")
            .send()
            .await?
            .error_for_status()?;
        let body: Value = response.json().await?;
        Ok(body["lyric"].as_str().filter(|lyric| !lyric.is_empty()).map(ToString::to_string))
    }

    async fn get_cover(&self, _song_id: &str, album_id: Option<&str>) -> anyhow::Result<Option<String>> {
        Ok(album_id.and_then(Self::image_url))
    }
}
