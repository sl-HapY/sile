use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Site {
    pub id: String,
    pub name: String,
    pub protocol: String, // "ftp" | "ftps" | "sftp"
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub remote_start: String,
    #[serde(default)]
    pub local_start: String,
    #[serde(default)]
    pub accept_invalid_certs: bool,
    #[serde(default)]
    pub color: String,
}

/// Site as exposed to the frontend (password stripped).
#[derive(Serialize, Clone)]
pub struct SiteView {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub remote_start: String,
    pub local_start: String,
    pub accept_invalid_certs: bool,
    pub color: String,
    pub has_password: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct StoredSite {
    #[serde(flatten)]
    base: SiteBase,
    enc_password: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct SiteBase {
    id: String,
    name: String,
    protocol: String,
    host: String,
    port: u16,
    username: String,
    #[serde(default)]
    remote_start: String,
    #[serde(default)]
    local_start: String,
    #[serde(default)]
    accept_invalid_certs: bool,
    #[serde(default)]
    color: String,
}

pub struct SiteStore {
    dir: PathBuf,
}

fn b64e(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn b64d(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())
}

impl SiteStore {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self { dir }
    }

    fn sites_path(&self) -> PathBuf {
        self.dir.join("sites.json")
    }

    fn key_path(&self) -> PathBuf {
        self.dir.join("secret.key")
    }

    fn load_key(&self) -> Result<[u8; 32], String> {
        let path = self.key_path();
        if path.exists() {
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
        let mut key = [0u8; 32];
        use rand::RngCore;
        rand::rngs::OsRng.fill_bytes(&mut key);
        std::fs::write(&path, &key).map_err(|e| e.to_string())?;
        Ok(key)
    }

    fn encrypt(&self, plain: &str) -> Result<String, String> {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};
        let key = self.load_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
        let nonce_bytes: [u8; 12] = {
            use rand::RngCore;
            let mut b = [0u8; 12];
            rand::rngs::OsRng.fill_bytes(&mut b);
            b
        };
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(nonce, plain.as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(b64e(&nonce_bytes) + ":" + &b64e(&ct))
    }

    fn decrypt(&self, enc: &str) -> Result<String, String> {
        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};
        let (n, c) = enc.split_once(':').ok_or("bad ciphertext")?;
        let key = self.load_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
        let nonce_bytes = b64d(n)?;
        let ct_bytes = b64d(c)?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let pt = cipher
            .decrypt(nonce, ct_bytes.as_slice())
            .map_err(|e| e.to_string())?;
        String::from_utf8(pt).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Result<Vec<StoredSite>, String> {
        let path = self.sites_path();
        if !path.exists() {
            return Ok(vec![]);
        }
        let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    }

    pub fn save_all(&self, sites: &[StoredSite]) -> Result<(), String> {
        let data = serde_json::to_string_pretty(sites).map_err(|e| e.to_string())?;
        std::fs::write(self.sites_path(), data).map_err(|e| e.to_string())
    }

    pub fn list_views(&self) -> Result<Vec<SiteView>, String> {
        Ok(self
            .list()?
            .into_iter()
            .map(|s| SiteView {
                id: s.base.id.clone(),
                name: s.base.name.clone(),
                protocol: s.base.protocol.clone(),
                host: s.base.host.clone(),
                port: s.base.port,
                username: s.base.username.clone(),
                remote_start: s.base.remote_start.clone(),
                local_start: s.base.local_start.clone(),
                accept_invalid_certs: s.base.accept_invalid_certs,
                color: s.base.color.clone(),
                has_password: !s.enc_password.is_empty(),
            })
            .collect())
    }

    pub fn get_site(&self, id: &str) -> Result<Site, String> {
        for s in self.list()? {
            if s.base.id == id {
                let password = if s.enc_password.is_empty() {
                    String::new()
                } else {
                    self.decrypt(&s.enc_password).unwrap_or_default()
                };
                return Ok(Site {
                    id: s.base.id,
                    name: s.base.name,
                    protocol: s.base.protocol,
                    host: s.base.host,
                    port: s.base.port,
                    username: s.base.username,
                    password,
                    remote_start: s.base.remote_start,
                    local_start: s.base.local_start,
                    accept_invalid_certs: s.base.accept_invalid_certs,
                    color: s.base.color,
                });
            }
        }
        Err("site not found".into())
    }

    pub fn upsert(&self, site: &Site) -> Result<(), String> {
        let mut sites = self.list()?;
        let enc_password = if site.password.is_empty() {
            // keep existing password if empty on update
            sites
                .iter()
                .find(|s| s.base.id == site.id)
                .map(|s| s.enc_password.clone())
                .unwrap_or_default()
        } else {
            self.encrypt(&site.password)?
        };
        let stored = StoredSite {
            base: SiteBase {
                id: site.id.clone(),
                name: site.name.clone(),
                protocol: site.protocol.clone(),
                host: site.host.clone(),
                port: site.port,
                username: site.username.clone(),
                remote_start: site.remote_start.clone(),
                local_start: site.local_start.clone(),
                accept_invalid_certs: site.accept_invalid_certs,
                color: site.color.clone(),
            },
            enc_password,
        };
        if let Some(pos) = sites.iter().position(|s| s.base.id == site.id) {
            sites[pos] = stored;
        } else {
            sites.push(stored);
        }
        self.save_all(&sites)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut sites = self.list()?;
        sites.retain(|s| s.base.id != id);
        self.save_all(&sites)
    }

    pub fn new_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }
}
