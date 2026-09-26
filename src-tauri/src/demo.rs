//! Original fictional records for an isolated demonstration library.
use crate::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Error, Result, Save},
    lifecycle, maintenance,
    photos::Selection,
    sales,
    storage::Store,
    taxonomy::{self, Classification},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct Demo {
    key: String,
    name: String,
    brand: String,
    model: String,
    price_cents: Option<String>,
    purchase_date: Option<String>,
    category: String,
    icon: taxonomy::Icon,
    channel: Option<String>,
    notes: String,
    retired_on: Option<String>,
    sale: Option<sales::Fields>,
    maintenance: Option<maintenance::Fields>,
}
fn request(key: &str, step: &str) -> String {
    let hash = Sha256::digest(format!("possio.original-demo.v1:{key}:{step}"));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    uuid::Uuid::from_bytes(bytes).to_string()
}
fn photo(key: &str) -> &'static [u8] {
    // The Demo illustrations are exactly the built-in material artwork.
    crate::materials::builtin(key)
        .expect("checked-in Demo key is a material id")
        .bytes
}
fn option(
    s: &mut Store,
    kind: taxonomy::Kind,
    name: &str,
    icon: Option<taxonomy::Icon>,
) -> Result<String> {
    let snapshot = s.taxonomy_snapshot()?;
    let entries = match kind {
        taxonomy::Kind::Category => &snapshot.categories,
        taxonomy::Kind::Channel => &snapshot.channels,
    };
    if let Some(entry) = entries.iter().find(|e| e.name == name) {
        return Ok(entry.id.clone());
    }
    // A fresh request is appropriate here: name lookup deduplicates already-created options.
    let next = s.change_taxonomy(&taxonomy::Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: snapshot.generation,
        expected_revision: snapshot.revision,
        command: taxonomy::Command::Create {
            kind,
            name: name.into(),
            icon,
        },
    })?;
    let entries = match kind {
        taxonomy::Kind::Category => next.categories,
        taxonomy::Kind::Channel => next.channels,
    };
    entries
        .into_iter()
        .find(|e| e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| Error::new("DEMO", "示例分类未能创建"))
}
fn import_one(s: &mut Store, a: &Demo, today: &str) -> Result<AssetRecord> {
    let generation = s.generation();
    let create_request = request(&a.key, "create");
    let record = if let Some(record) = s.saved_request(&create_request, &generation)? {
        record
    } else {
        let category_id = option(s, taxonomy::Kind::Category, &a.category, Some(a.icon))?;
        let channel_id = a
            .channel
            .as_ref()
            .map(|name| option(s, taxonomy::Kind::Channel, name, None))
            .transpose()?;
        let cover = s.stage_photo(
            &format!("原始 Demo 示意图（非实物照片）-{}.png", a.key),
            photo(&a.key),
            &generation,
            None,
        )?;
        s.save_asset(
            &SaveAsset {
                options: None,
                base: Save {
                    request_id: create_request,
                    generation: generation.clone(),
                    asset_id: None,
                    expected_revision: None,
                    name: a.name.clone(),
                    price_cents: a.price_cents.clone(),
                    purchase_date: a.purchase_date.clone(),
                },
                details: Details {
                    brand: a.brand.clone(),
                    model: a.model.clone(),
                    serial_number: String::new(),
                    notes: format!(
                        "{}\n\n原始 Demo 虚构样例，可编辑体验；图片为示意图。",
                        a.notes
                    ),
                },
                photos: Some(Selection {
                    ids: vec![cover.id.clone()],
                    cover_id: Some(cover.id),
                }),
                classification: Some(Classification {
                    category_id: Some(category_id),
                    channel_id,
                }),
            },
            today,
        )?
    };
    // Never infer the expected revision from a subsequently edited record. Partial imports
    // resume only at their original revision; completed imports never overwrite user edits.
    let mut expected_revision = 1;
    if let Some(fields) = &a.maintenance {
        let id = request(&a.key, "maintenance");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_maintenance(
                &maintenance::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: maintenance::Action::Add {
                        fields: fields.clone(),
                        photos: Selection {
                            ids: vec![],
                            cover_id: None,
                        },
                    },
                },
                today,
            )?;
        }
        expected_revision += 1;
    }
    if let Some(date) = &a.retired_on {
        let id = request(&a.key, "retire");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_lifecycle(
                &lifecycle::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: lifecycle::Action::Append {
                        kind: lifecycle::Kind::Retire,
                        date: date.clone(),
                        notes: "原始 Demo：留作备用机".into(),
                    },
                },
                today,
            )?;
        }
        expected_revision += 1;
    }
    if let Some(fields) = &a.sale {
        let id = request(&a.key, "sale");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_sale(
                &sales::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: sales::Action::Sell {
                        fields: fields.clone(),
                    },
                },
                today,
            )?;
        }
    }
    s.record(&record.asset.id)?
        .ok_or_else(|| Error::new("DEMO", "示例档案读取失败"))
}
pub fn import(s: &mut Store, today: &str) -> Result<Vec<AssetRecord>> {
    let data: Vec<Demo> = serde_json::from_str(include_str!("../../src/demo-assets.json"))?;
    let mut output = Vec::new();
    for a in data.iter().rev() {
        output.push(import_one(s, a, today)?);
    }
    output.reverse();
    Ok(output)
}
