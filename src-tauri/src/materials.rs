//! Material library: built-in illustrations embedded at compile time plus
//! user-uploaded materials persisted in the `materials` table (schema 9).
//! Clients reference material by catalog id or material uuid only; arbitrary
//! paths, URLs or raw bytes are never accepted as "material".
use crate::{
    domain::{Error, Result},
    files::{validate_image, MAX_IMAGE_BYTES},
    storage::{atomic_write, digest, uid, Store},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Material {
    pub id: String,
    pub name: String,
}
pub struct MaterialAsset {
    pub material: Material,
    pub bytes: &'static [u8],
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MaterialEntry {
    pub id: String,
    pub name: String,
    pub builtin: bool,
}
pub fn catalog() -> Result<Vec<Material>> {
    serde_json::from_str(include_str!("../materials/materials.json"))
        .map_err(|_| Error::new("MATERIAL", "素材清单不可用"))
}
// Unknown, blank or traversal-like ids match no arm and are rejected.
fn artwork(id: &str) -> Option<&'static [u8]> {
    Some(match id {
        "laptop" => include_bytes!("../materials/laptop.png"),
        "camera" => include_bytes!("../materials/camera.png"),
        "headphones" => include_bytes!("../materials/headphones.png"),
        "phone" => include_bytes!("../materials/phone.png"),
        "tablet" => include_bytes!("../materials/tablet.png"),
        "keyboard" => include_bytes!("../materials/keyboard.png"),
        "coffee" => include_bytes!("../materials/coffee.png"),
        "box" => include_bytes!("../materials/box.png"),
        _ => return None,
    })
}
pub fn builtin(id: &str) -> Option<MaterialAsset> {
    let material = catalog().ok()?.into_iter().find(|m| m.id == id)?;
    Some(MaterialAsset {
        material,
        bytes: artwork(id)?,
    })
}
fn display_name(path: &Path) -> String {
    let name: String = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .filter(|c| !c.is_control())
        .take(255)
        .collect();
    if name.trim().is_empty() {
        "自定义素材".into()
    } else {
        name
    }
}
impl Store {
    /// Built-in catalog first (stable order), then user uploads by creation.
    pub fn material_entries(&self) -> Result<Vec<MaterialEntry>> {
        let mut entries: Vec<MaterialEntry> = catalog()?
            .into_iter()
            .map(|m| MaterialEntry {
                id: m.id,
                name: m.name,
                builtin: true,
            })
            .collect();
        let mut stmt = self
            .conn()?
            .prepare("SELECT id,name FROM materials ORDER BY created_at,id")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(MaterialEntry {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    builtin: false,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        entries.extend(rows);
        Ok(entries)
    }
    /// Persist a user-chosen image as a library material. The original bytes
    /// land in the content-addressed store before the catalog row commits.
    pub fn add_material(&self, path: &Path, generation: &str) -> Result<MaterialEntry> {
        self.add_material_once(path, generation, &uid())
    }
    pub fn material_upload_result(
        &self,
        request: &str,
        generation: &str,
    ) -> Result<Option<MaterialEntry>> {
        self.check_generation(generation)?;
        uuid::Uuid::parse_str(request).map_err(|_| Error::new("MATERIAL", "上传操作标识无效"))?;
        Ok(self
            .conn()?
            .query_row(
                "SELECT id,name FROM materials WHERE id=?1",
                [request],
                |r| {
                    Ok(MaterialEntry {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        builtin: false,
                    })
                },
            )
            .optional()?)
    }
    /// The upload operation UUID is the row ID. Check it before reading the
    /// source again: a lost response must not create a second material.
    pub fn add_material_once(
        &self,
        path: &Path,
        generation: &str,
        request: &str,
    ) -> Result<MaterialEntry> {
        if let Some(entry) = self.material_upload_result(request, generation)? {
            return Ok(entry);
        }
        let meta = fs::metadata(path)?;
        if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES as u64 {
            return Err(Error::new("IMAGE_SIZE", "请选择不超过 20 MiB 的图片文件"));
        }
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take(MAX_IMAGE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(Error::new("IMAGE_SIZE", "请选择不超过 20 MiB 的图片文件"));
        }
        validate_image(&bytes)?;
        // Require a displayable preview before the material joins the library.
        let _ = crate::native_images::preview(&bytes)?;
        let hash = digest(&bytes);
        let dir = self.dataset();
        for folder in ["files", "cache"] {
            fs::create_dir_all(dir.join(folder))?;
        }
        atomic_write(&dir.join("files").join(&hash), &bytes)?;
        let entry = MaterialEntry {
            id: request.into(),
            name: display_name(path),
            builtin: false,
        };
        self.hit("material.before_commit")?;
        self.conn()?.execute(
            "INSERT INTO materials VALUES(?1,?2,?3,?4,?5)",
            params![
                entry.id,
                entry.name,
                hash,
                bytes.len() as i64,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        self.hit("material.after_commit")?;
        Ok(entry)
    }
    /// Built-in materials stay; removing a user material never touches saved
    /// assets, whose photos keep their own hosted copies.
    pub fn remove_material(&self, id: &str, generation: &str) -> Result<Vec<MaterialEntry>> {
        self.check_generation(generation)?;
        if builtin(id).is_some() {
            return Err(Error::new("MATERIAL", "内置素材不能删除"));
        }
        uuid::Uuid::parse_str(id).map_err(|_| Error::new("MATERIAL", "未知素材"))?;
        if self
            .conn()?
            .execute("DELETE FROM materials WHERE id=?1", [id])?
            != 1
        {
            return Err(Error::new("MATERIAL", "未知素材"));
        }
        self.material_entries()
    }
    fn user_material(&self, id: &str) -> Result<Option<(String, String)>> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Ok(None);
        }
        Ok(self
            .conn()?
            .query_row("SELECT name,hash FROM materials WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?)
    }
    /// Stage a library material through the normal photo pipeline so the
    /// selection is durable, previewable and committed with `save_asset`.
    pub fn prepare_material(&self, id: &str, generation: &str) -> Result<crate::photos::Photo> {
        if let Some(asset) = builtin(id) {
            let name = format!("{}示意图（非实物照片）", asset.material.name);
            return self.stage_photo(&name, asset.bytes, generation, None);
        }
        if let Some((name, hash)) = self.user_material(id)? {
            let bytes = self.original(&hash)?;
            return self.stage_photo(&name, &bytes, generation, None);
        }
        Err(Error::new("MATERIAL", "未知素材，请重新选择"))
    }
    pub fn material_preview(&self, id: &str, generation: &str) -> Result<Vec<u8>> {
        self.check_generation(generation)?;
        if let Some(asset) = builtin(id) {
            return Ok(asset.bytes.to_vec());
        }
        if let Some((_, hash)) = self.user_material(id)? {
            return self.preview_by_hash(&hash);
        }
        Err(Error::new("MATERIAL", "未知素材"))
    }
}
