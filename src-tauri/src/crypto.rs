//! API Key 加密解密模块
//! 方案：AES-256-GCM + 应用路径派生密钥 + `enc:` 前缀标识
//! 安全级别：防止 SQLite 明文泄漏 + 加密数据迁移兼容

use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::{Aead, OsRng};
use rand::RngCore;
use sha2::{Sha256, Digest};

use base64::Engine;
use std::path::Path;

const APP_SALT: &[u8] = b"xingmian-v1.3-seal";
const ENC_PREFIX: &str = "enc:";


/// 从应用数据路径派生 256-bit 密钥（跨平台一致）
fn derive_key(app_data_dir: &Path) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(app_data_dir.to_string_lossy().as_bytes());
    let hash = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    key
}

/// 加密明文 → `enc:base64(nonce+ciphertext)`
pub fn encrypt_api_key(plain: &str, app_data_dir: &Path) -> String {
    if plain.is_empty() {
        return String::new();
    }
    // 已加密的数据不重复加密
    if plain.starts_with(ENC_PREFIX) {
        return plain.to_string();
    }

    let key = derive_key(app_data_dir);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("AES-GCM key");

    // 生成随机 12 字节 nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .expect("AES-GCM encrypt");

    // 编码: nonce(12 bytes) + ciphertext → base64
    let mut payload = Vec::with_capacity(12 + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);

    format!("{}{}", ENC_PREFIX, base64::engine::general_purpose::STANDARD.encode(&payload))
}

/// 解密 `enc:xxx` → 明文；无前缀视为旧明文（兼容）
pub fn decrypt_api_key(stored: &str, app_data_dir: &Path) -> String {
    if stored.is_empty() {
        return String::new();
    }
    // 无 enc: 前缀 → 旧明文，直接返回
    if !stored.starts_with(ENC_PREFIX) {
        return stored.to_string();
    }

    let key = derive_key(app_data_dir);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("AES-GCM key");

    let encoded = &stored[ENC_PREFIX.len()..];

    match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(payload) if payload.len() >= 12 => {
            let (nonce_bytes, ct) = payload.split_at(12);
            let nonce = Nonce::from_slice(nonce_bytes);
            cipher
                .decrypt(nonce, ct)
                .map(|pt| String::from_utf8_lossy(&pt).into_owned())
                .unwrap_or_else(|_| {
                    // 解密失败（换机/换路径），返回占位防止崩溃
                    String::new()
                })
        }
        _ => stored.to_string(), // 解码失败，当作明文处理
    }
}

/// 迁移旧明文数据:
/// 遍历 platforms 表，把非 `enc:` 前缀的 api_key 加密回写
pub fn migrate_plaintext_keys(conn: &rusqlite::Connection, app_data_dir: &Path) -> Result<usize, String> {
    let mut stmt = conn
        .prepare("SELECT id, api_key FROM platforms WHERE api_key != '' AND api_key NOT LIKE 'enc:%'")
        .map_err(|e| e.to_string())?;

    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut count = 0;
    for (id, plain_key) in &rows {
        let encrypted = encrypt_api_key(plain_key, app_data_dir);
        conn.execute(
            "UPDATE platforms SET api_key = ?1 WHERE id = ?2",
            rusqlite::params![encrypted, id],
        )
        .map_err(|e| e.to_string())?;
        count += 1;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let dir = PathBuf::from("/test/star_sleep");
        let original = "sk-test-api-key-1234567890abcdef";
        let encrypted = encrypt_api_key(original, &dir);
        assert!(encrypted.starts_with("enc:"));
        assert_ne!(encrypted, original);
        let decrypted = decrypt_api_key(&encrypted, &dir);
        assert_eq!(decrypted, original);
    }

    #[test]
    fn test_idempotent_encrypt() {
        let dir = PathBuf::from("/test/star_sleep");
        let original = "sk-key";
        let once = encrypt_api_key(original, &dir);
        let twice = encrypt_api_key(&once, &dir);
        assert_eq!(once, twice); // 已加密不再重复
    }

    #[test]
    fn test_old_plaintext_compat() {
        let dir = PathBuf::from("/test/star_sleep");
        let old_plain = "sk-old-key-12345";
        let decrypted = decrypt_api_key(old_plain, &dir);
        assert_eq!(decrypted, old_plain); // 旧明文直接返回
    }

    #[test]
    fn test_empty_key() {
        let dir = PathBuf::from("/test");
        assert!(encrypt_api_key("", &dir).is_empty());
        assert!(decrypt_api_key("", &dir).is_empty());
    }
}
