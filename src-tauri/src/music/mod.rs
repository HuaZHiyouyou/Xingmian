pub mod netease;
pub mod kuwo;
pub mod bilibili;
pub mod qq;
pub mod kugou;
pub mod proxy;
pub mod commands;

use serde::{Deserialize, Serialize};

/// 统一歌曲数据结构（所有平台共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedSong {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration: u64,
    pub platform: String,
    pub cover: Option<String>,
    /// 歌词文本（部分平台可直接获取）
    pub lyrics: Option<String>,
}

/// 播放URL结果（含降级信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayUrlResult {
    pub url: String,
    pub quality: String,
    pub format: String,
    pub file_size: Option<u64>,
    pub needs_proxy: bool,
    /// 备用URL列表（用于降级）
    pub fallback_urls: Vec<String>,
}

/// 搜索结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub songs: Vec<UnifiedSong>,
    pub has_more: bool,
    pub total: u64,
}

/// 音乐源 trait
#[async_trait::async_trait]
pub trait MusicSource: Send + Sync {
    /// 平台名称
    fn name(&self) -> &str;

    /// 搜索歌曲
    async fn search(&self, keyword: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult>;

    /// 获取播放URL
    async fn get_play_url(&self, song_id: &str) -> anyhow::Result<PlayUrlResult>;

    /// 获取歌词
    async fn get_lyrics(&self, song_id: &str) -> anyhow::Result<Option<String>>;

    /// 获取歌曲封面
    async fn get_cover(&self, song_id: &str, album_id: Option<&str>) -> anyhow::Result<Option<String>>;
}

/// 全局音乐管理器
pub struct MusicManager {
    sources: Vec<Box<dyn MusicSource>>,
}

impl MusicManager {
    pub fn new() -> Self {
        let sources: Vec<Box<dyn MusicSource>> = vec![
            Box::new(netease::NeteaseMusic::new()),
            Box::new(kuwo::KuwoMusic::new()),
            Box::new(bilibili::BilibiliMusic::new()),
            Box::new(qq::QqMusic::new()),
            Box::new(kugou::KuGouMusic::new()),
        ];
        Self { sources }
    }

    /// 多源聚合搜索
    pub async fn search_all(&self, keyword: &str, page: u32, page_size: u32) -> Vec<UnifiedSong> {
        let mut all_songs = Vec::new();

        // 并发搜索所有源
        let futs: Vec<_> = self.sources.iter().map(|src| {
            let keyword = keyword.to_string();
            let src_ref = src.as_ref();
            async move {
                match src_ref.search(&keyword, page, page_size).await {
                    Ok(result) => result.songs,
                    Err(e) => {
                        log::warn!("搜索源 {} 失败: {}", src_ref.name(), e);
                        vec![]
                    }
                }
            }
        }).collect();

        let results = futures_util::future::join_all(futs).await;
        for songs in results {
            all_songs.extend(songs);
        }

        all_songs
    }

    /// 单源搜索
    pub async fn search_single(&self, keyword: &str, platform: &str, page: u32, page_size: u32) -> anyhow::Result<SearchResult> {
        for src in &self.sources {
            if src.name() == platform {
                return src.search(keyword, page, page_size).await;
            }
        }
        anyhow::bail!("未知平台: {}", platform)
    }

    /// 多源降级获取播放URL
    pub async fn get_play_url(&self, song_id: &str, platform: &str) -> anyhow::Result<PlayUrlResult> {
        // 优先从指定平台获取
        if let Some(src) = self.sources.iter().find(|s| s.name() == platform) {
            match src.get_play_url(song_id).await {
                Ok(result) if !result.url.is_empty() => return Ok(result),
                Ok(_) => log::warn!("平台 {} 返回空URL，尝试降级", platform),
                Err(e) => log::warn!("平台 {} 获取URL失败: {}，尝试降级", platform, e),
            }
        }

        // 降级：尝试其他源
        for src in &self.sources {
            if src.name() != platform {
                match src.get_play_url(song_id).await {
                    Ok(result) if !result.url.is_empty() => {
                        log::info!("降级到平台 {} 获取URL成功", src.name());
                        return Ok(result);
                    }
                    _ => continue,
                }
            }
        }

        anyhow::bail!("所有平台都无法获取播放URL")
    }

    /// 获取可用平台列表
    pub fn available_platforms(&self) -> Vec<String> {
        self.sources.iter().map(|s| s.name().to_string()).collect()
    }

    /// 获取歌词
    pub async fn get_lyrics(&self, song_id: &str, platform: &str) -> anyhow::Result<Option<String>> {
        for src in &self.sources {
            if src.name() == platform {
                return src.get_lyrics(song_id).await;
            }
        }
        anyhow::bail!("未知平台: {}", platform)
    }

    /// 获取封面URL
    pub async fn get_cover(&self, song_id: &str, platform: &str, album_id: Option<&str>) -> anyhow::Result<Option<String>> {
        for src in &self.sources {
            if src.name() == platform {
                return src.get_cover(song_id, album_id).await;
            }
        }
        anyhow::bail!("未知平台: {}", platform)
    }
}
