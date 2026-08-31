//! ============================================================
//! 本地音频流代理（Music Audio Proxy）
//!
//! 目的：让前端 WebAudio AnalyserNode 能分析在线音源。
//! 浏览器安全策略下，跨域且无 CORS 头的音频一旦接入
//! MediaElementSource 会整体静音。本代理在 127.0.0.1 起一个
//! 轻量流式转发服务，为所有响应注入
//! `Access-Control-Allow-Origin: *`，前端以同源+匿名模式加载
//! 即可安全获取实时频谱，同时完整支持 Range（拖动进度）。
//!
//! 端点：GET /stream?url=<urlencoded http(s) url 或本地文件绝对路径>
//! ============================================================

use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

static PROXY_PORT: AtomicU16 = AtomicU16::new(0);

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 启动代理服务（幂等），返回端口
pub async fn ensure_proxy_started() -> anyhow::Result<u16> {
    let existing = PROXY_PORT.load(Ordering::SeqCst);
    if existing != 0 {
        return Ok(existing);
    }
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    PROXY_PORT.store(port, Ordering::SeqCst);
    log::info!("[MusicProxy] listening on 127.0.0.1:{}", port);
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tokio::spawn(async move {
                        let _ = handle_conn(stream).await;
                    });
                }
                Err(e) => log::warn!("[MusicProxy] accept error: {}", e),
            }
        }
    });
    Ok(port)
}

/// 解析请求行，取出 /stream?url= 参数与 Range 头
async fn handle_conn(mut stream: TcpStream) -> anyhow::Result<()> {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut target = String::new();
    let mut range: Option<String> = None;
    for (i, line) in req.lines().enumerate() {
        if i == 0 {
            // GET /stream?url=... HTTP/1.1
            if let Some(path) = line.split_whitespace().nth(1) {
                target = path.to_string();
            }
        }
        let lower = line.to_lowercase();
        if lower.starts_with("range:") {
            range = Some(line.split_once(':').map(|x| x.1).unwrap_or("").trim().to_string());
        }
    }

    let url = target
        .strip_prefix("/stream?url=")
        .map(|v| urlencoding::decode(v).map(|s| s.to_string()).unwrap_or_default())
        .unwrap_or_default();
    if url.is_empty() {
        write_simple(&mut stream, 400, "missing url").await?;
        return Ok(());
    }

    // 本地文件（file:// 或绝对路径）
    let is_local = url.starts_with("file://") || url.starts_with('/') || url.contains(":\\");
    if is_local {
        let path = url
            .trim_start_matches("file://")
            .trim_start_matches("file:/")
            .to_string();
        serve_local_file(&mut stream, &path, range.as_deref()).await;
        return Ok(());
    }

    let mut req = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()?
        .get(&url)
        .header("Referer", "https://music.163.com/");
    if let Some(ref r) = range {
        req = req.header("Range", r.clone());
    }
    let upstream: anyhow::Result<reqwest::Response> = req.send().await.map_err(|e| anyhow::anyhow!(e.to_string()));

    let resp = match upstream {
        Ok(r) => r,
        Err(e) => {
            write_simple(&mut stream, 502, &format!("upstream error: {}", e)).await?;
            return Ok(());
        }
    };

    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();
    let content_length = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_range = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // 响应头（注入 CORS）
    let mut head = String::new();
    head.push_str(&format!("HTTP/1.1 {} OK\r\n", if status == 206 { 206 } else { 200 }));
    head.push_str(&format!("Content-Type: {}\r\n", content_type));
    head.push_str("Access-Control-Allow-Origin: *\r\n");
    head.push_str("Access-Control-Allow-Headers: Range, Content-Type\r\n");
    head.push_str("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n");
    head.push_str("Accept-Ranges: bytes\r\n");
    if !content_range.is_empty() {
        head.push_str(&format!("Content-Range: {}\r\n", content_range));
    }
    if !content_length.is_empty() {
        head.push_str(&format!("Content-Length: {}\r\n", content_length));
    }
    head.push_str("Connection: close\r\n\r\n");
    stream.write_all(head.as_bytes()).await?;

    // 流式转发
    let mut resp = resp;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if stream.write_all(&chunk).await.is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
    let _ = stream.flush().await;
    Ok(())
}

/// 本地文件服务（支持 Range）
async fn serve_local_file(stream: &mut TcpStream, path: &str, range: Option<&str>) {
    let path = PathBuf::from(path);
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_file() => {
            let total = meta.len();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("mp3")
                .to_string();
            let mime = match ext.as_str() {
                "flac" => "audio/flac",
                "wav" => "audio/wav",
                "ogg" => "audio/ogg",
                "m4a" => "audio/mp4",
                "aac" => "audio/aac",
                _ => "audio/mpeg",
            };
            let (start, end, partial) = range
                .and_then(|r| r.strip_prefix("bytes="))
                .and_then(|r| r.split('-').next().and_then(|s| s.parse::<u64>().ok()))
                .map(|s| (s, total - 1, true))
                .unwrap_or((0, total - 1, false));
            let len = end - start + 1;

            let mut head = format!(
                "HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccept-Ranges: bytes\r\n",
                if partial { 206 } else { 200 },
                mime,
                len
            );
            if partial {
                head.push_str(&format!("Content-Range: bytes {}-{}/{}\r\n", start, end, total));
            }
            head.push_str("\r\n");
            if stream.write_all(head.as_bytes()).await.is_err() {
                return;
            }

            use tokio::io::{AsyncSeekExt, SeekFrom};
            let mut file = match tokio::fs::File::open(&path).await {
                Ok(f) => f,
                Err(_) => return,
            };
            if start > 0 {
                let _ = file.seek(SeekFrom::Start(start)).await;
            }
            let mut remaining = len;
            let mut buf = vec![0u8; 64 * 1024];
            while remaining > 0 {
                let want = std::cmp::min(remaining as usize, buf.len());
                match file.read(&mut buf[..want]).await {
                    Ok(0) => break,
                    Ok(read) => {
                        if stream.write_all(&buf[..read]).await.is_err() {
                            break;
                        }
                        remaining -= read as u64;
                    }
                    Err(_) => break,
                }
            }
            let _ = stream.flush().await;
        }
        _ => {
            let _ = write_simple(stream, 404, "file not found").await;
        }
    }
}

async fn write_simple(stream: &mut TcpStream, code: u16, msg: &str) -> anyhow::Result<()> {
    let body = format!("{{\"error\":\"{}\"}}", msg.replace('"', "'"));
    let resp = format!(
        "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        code,
        body.len(),
        body
    );
    stream.write_all(resp.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}
