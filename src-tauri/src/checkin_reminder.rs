//! Optional reminder to repeat the account check-in.
//!
//! A machine-local preference (like auto backup), never part of the library or
//! its backups. The reminder is derived from the last complete check-in, so it
//! is never an asset fact and saving a new check-in cancels the old one.
use crate::{
    domain::{date, Error, Result},
    reminders::Plan,
    storage::Store,
};
use chrono::{Days, Months, NaiveDate};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

/// Days between the first reminder and the single follow-up.
const FOLLOW_UP_DAYS: u64 = 7;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Months after the last complete check-in; 0 means off.
    #[serde(default)]
    pub months: u32,
}
impl Settings {
    /// A missing or damaged file reads as off; it never blocks anything.
    pub fn load(root: &Path) -> Self {
        fs::read(root.join("checkin-reminder.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Self>(&bytes).ok())
            .filter(|s| s.validate().is_ok())
            .unwrap_or_default()
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        self.validate()?;
        crate::storage::atomic_write(
            &root.join("checkin-reminder.json"),
            &serde_json::to_vec(self)?,
        )
    }
    fn validate(&self) -> Result<()> {
        if self.months <= 3 {
            Ok(())
        } else {
            Err(Error::new(
                "CHECKIN_REMINDER",
                "提醒间隔须为关闭、1、2 或 3 个月",
            ))
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub months: u32,
    /// Date of the last complete check-in the reminder counts from.
    pub last_check_in: Option<String>,
    /// First reminder date, which may already be past.
    pub next_date: Option<String>,
}

/// First reminder and its single follow-up for a check-in on `last`.
pub fn due_dates(months: u32, last: &str) -> Result<Option<(NaiveDate, NaiveDate)>> {
    if months == 0 {
        return Ok(None);
    }
    let due = date(last)?
        .checked_add_months(Months::new(months))
        .ok_or_else(|| Error::new("DATE", "提醒日期超出范围"))?;
    let follow_up = due
        .checked_add_days(Days::new(FOLLOW_UP_DAYS))
        .ok_or_else(|| Error::new("DATE", "提醒日期超出范围"))?;
    Ok(Some((due, follow_up)))
}

impl Store {
    fn last_complete_check_in(&self) -> Result<Option<String>> {
        Ok(self
            .wealth_summary()?
            .points
            .iter()
            .rev()
            .find(|p| p.complete)
            .map(|p| p.date.clone()))
    }
    pub fn checkin_reminder_status(&self) -> Result<Status> {
        let months = Settings::load(&self.root).months;
        let last = self.last_complete_check_in()?;
        let next = match &last {
            Some(l) => due_dates(months, l)?.map(|(due, _)| due.to_string()),
            None => None,
        };
        Ok(Status {
            months,
            last_check_in: last,
            next_date: next,
        })
    }
    /// Notification plans; the native layer drops dates that already passed.
    pub fn checkin_reminder_plans(&self) -> Result<Vec<Plan>> {
        let months = Settings::load(&self.root).months;
        if months == 0 {
            return Ok(Vec::new());
        }
        let Some(last) = self.last_complete_check_in()? else {
            return Ok(Vec::new());
        };
        let Some((due, follow_up)) = due_dates(months, &last)? else {
            return Ok(Vec::new());
        };
        let body =
            format!("距上次完整盘点（{last}）已满 {months} 个月，花几分钟更新各账户余额吧。");
        Ok([(due, "盘点提醒"), (follow_up, "盘点提醒 · 还没盘点")]
            .into_iter()
            .map(|(day, title)| Plan {
                id: format!("thingary-checkin-{day}"),
                date: day.to_string(),
                title: title.into(),
                body: body.clone(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn due_dates_follow_calendar_months_and_clamp_month_ends() {
        let (due, late) = due_dates(1, "2026-01-31").unwrap().unwrap();
        assert_eq!(due.to_string(), "2026-02-28");
        assert_eq!(late.to_string(), "2026-03-07");
        assert_eq!(
            due_dates(3, "2026-10-13").unwrap().unwrap().0.to_string(),
            "2027-01-13"
        );
        assert!(due_dates(0, "2026-10-13").unwrap().is_none());
    }

    #[test]
    fn settings_reject_unknown_intervals_and_read_damage_as_off() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Settings { months: 4 }.save(dir.path()).is_err());
        assert_eq!(Settings::load(dir.path()).months, 0);
        Settings { months: 2 }.save(dir.path()).unwrap();
        assert_eq!(Settings::load(dir.path()).months, 2);
        fs::write(dir.path().join("checkin-reminder.json"), b"{broken").unwrap();
        assert_eq!(Settings::load(dir.path()).months, 0);
        fs::write(dir.path().join("checkin-reminder.json"), br#"{"months":9}"#).unwrap();
        assert_eq!(Settings::load(dir.path()).months, 0);
    }
}
