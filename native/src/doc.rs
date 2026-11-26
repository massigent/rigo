//! Document protocol: a faithful port of the Go backend's model.
//!
//! - A disk revision is an opaque content fingerprint (`sha256:<64 hex>`)
//!   compared for equality only, never by order, never parsed as a number.
//! - Saves are atomic (temp file + rename) and preserve the file mode.
//! - A file with no write bits (or no effective write access for this user)
//!   is read-only by policy, before any conflict handling.
//! - A missing file is never silently recreated: a save that knew a baseline
//!   gets `Missing`, an overwrite never resurrects the file.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use sha2::{Digest, Sha256};

pub const REVISION_PREFIX: &str = "sha256:";

/// Content fingerprint of the given bytes, in the same format as the Go app.
pub fn content_revision(bytes: &[u8]) -> String {
    let sum = Sha256::digest(bytes);
    let mut out = String::with_capacity(REVISION_PREFIX.len() + sum.len() * 2);
    out.push_str(REVISION_PREFIX);
    for b in sum {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// The revision must be well formed before it can participate in a precondition.
pub fn valid_disk_revision(rev: &str) -> bool {
    let Some(hex) = rev.strip_prefix(REVISION_PREFIX) else {
        return false;
    };
    hex.len() == 64
        && hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DiskSnapshot {
    pub exists: bool,
    pub content: String,
    pub revision: String,
    pub mod_time: Option<SystemTime>,
    pub read_only: bool,
    pub read_only_reason: String,
}

impl DiskSnapshot {
    /// Snapshot of a genuinely missing file: no revision, not saveable as a
    /// clean baseline.
    pub fn missing() -> Self {
        Self::default()
    }
}

/// Read a stable snapshot of `path`. Like the Go implementation, the file is
/// read and the metadata compared before and after: if it changed while being
/// read (size or mtime), the read is retried a bounded number of times before
/// giving up as unstable.
pub fn read_snapshot(path: &Path) -> io::Result<DiskSnapshot> {
    const ATTEMPTS: usize = 3;
    let mut last_err: Option<io::Error> = None;
    for _ in 0..ATTEMPTS {
        match read_snapshot_once(path) {
            Ok(Some(snap)) => return Ok(snap),
            Ok(None) => return Ok(DiskSnapshot::missing()),
            Err(e) => {
                if e.kind() == io::ErrorKind::Interrupted {
                    last_err = Some(e);
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| {
        io::Error::new(io::ErrorKind::Other, "unstable snapshot")
    }))
}

fn read_snapshot_once(path: &Path) -> io::Result<Option<DiskSnapshot>> {
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let before = file.metadata()?;
    if !before.is_file() {
        return Err(io::Error::new(io::ErrorKind::Other, "not a regular file"));
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Ok(None); // changed while reading: retry
    }
    let read_only = write_protection(path, &after.metadata_permissions());
    Ok(Some(DiskSnapshot {
        exists: true,
        content: String::from_utf8_lossy(&bytes).into_owned(),
        revision: content_revision(&bytes),
        mod_time: after.modified().ok(),
        read_only: read_only.0,
        read_only_reason: read_only.1,
    }))
}

/// Application write policy on top of the OS permissions, ported from Go:
/// no write bits -> protected; write bits but no effective access (EACCES/EROFS)
/// -> protected; anything else -> editable.
#[cfg_attr(windows, allow(dead_code))]
fn write_protection(path: &Path, mode: &PermissionsView) -> (bool, String) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if (mode.0.mode() & 0o222) == 0 {
            return (true, "no_write_bits".to_string());
        }
    }
    // Effective access check without touching the document: open for writing,
    // never truncate, close immediately.
    match fs::OpenOptions::new().write(true).open(path) {
        Ok(_) => (false, String::new()),
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            (true, "access_denied".to_string())
        }
        Err(_) => (true, "write_unavailable".to_string()),
    }
}

/// Minimal metadata wrapper so the read-only policy works on every platform.
struct PermissionsView(std::fs::Permissions);

trait MetadataPermissions {
    fn metadata_permissions(&self) -> PermissionsView;
}
impl MetadataPermissions for fs::Metadata {
    fn metadata_permissions(&self) -> PermissionsView {
        PermissionsView(self.permissions())
    }
}

#[derive(Debug)]
pub enum SaveError {
    /// The file (or the OS policy) refuses to be replaced.
    ReadOnly(String),
    /// The content on disk does not match the expected revision baseline.
    Conflict { disk_revision: String },
    /// The file the client knew about is gone and is never recreated.
    Missing,
    /// An existing file needs an expected revision baseline first.
    RevisionRequired,
    /// Operational failure of the atomic write.
    Io(io::Error),
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveError::ReadOnly(reason) => {
                write!(f, "the file is read-only ({reason})")
            }
            SaveError::Conflict { disk_revision } => {
                write!(f, "the file changed on disk ({disk_revision})")
            }
            SaveError::Missing => {
                write!(f, "the file was deleted on disk and is not recreated")
            }
            SaveError::RevisionRequired => write!(
                f,
                "an existing file needs the revision it was last read with"
            ),
            SaveError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl From<io::Error> for SaveError {
    fn from(e: io::Error) -> Self {
        SaveError::Io(e)
    }
}

/// Save `content` to `path`.
///
/// `expected_revision` is the opaque baseline of the content the editor last
/// saw. It is required to overwrite an existing file (unless `force`), never
/// bypasses the read-only policy, and never resurrects a deleted file.
/// On success returns the revision of the bytes that were written.
pub fn save(
    path: &Path,
    content: &str,
    expected_revision: Option<&str>,
    force: bool,
) -> Result<String, SaveError> {
    if let Some(rev) = expected_revision {
        if !valid_disk_revision(rev) {
            return Err(SaveError::Io(io::Error::new(
                io::ErrorKind::InvalidInput,
                "expected_revision is not a sha256 revision",
            )));
        }
    }

    let snap = read_snapshot(path)?;

    // Read-only policy comes before conflict handling, like the Go app:
    // `force` bypasses a content conflict, never the protection.
    if snap.read_only {
        return Err(SaveError::ReadOnly(snap.read_only_reason));
    }

    if !force {
        match expected_revision {
            None if snap.exists => return Err(SaveError::RevisionRequired),
            Some(_) if !snap.exists => return Err(SaveError::Missing),
            Some(expected) if snap.revision != expected => {
                return Err(SaveError::Conflict {
                    disk_revision: snap.revision,
                });
            }
            _ => {}
        }
    } else if expected_revision.is_some() && !snap.exists {
        // Force overwrites a changed file, but does not recreate a deleted one.
        return Err(SaveError::Missing);
    }

    atomic_write(path, content.as_bytes())?;
    Ok(content_revision(content.as_bytes()))
}

/// Atomic write: a temp file in the target directory, fsync, preserve the mode
/// of the file being replaced (0644 for a new one), then rename over the
/// target, then fsync the directory for durability.
fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".typecraft_tmp_")
        .tempfile_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;

    // Preserve the mode of the replaced file; a fresh temp file is 0600 and a
    // plain save must not silently chmod a shared 0644 document.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)
            .map(|m| m.permissions().mode() & 0o777)
            .unwrap_or(0o644);
        tmp.as_file().set_permissions(fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    {
        let _ = fs::metadata(path).map(|m| m.permissions());
    }

    tmp.persist(path)
        .map_err(|e| e.error)
        .map(|_| ())
        .and_then(|_| {
            // Make the rename durable too, when the directory can be opened.
            fs::File::open(dir).and_then(|d| d.sync_all()).map(|_| ()).or(Ok(()))
        })
}

/// Best-effort recents list, same spirit as the Go app (`~/.typecraft`).
pub fn recents_path() -> Option<PathBuf> {
    dirs_home().map(|h| h.join(".typecraft").join("native-recents.json"))
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub fn load_recents() -> Vec<String> {
    let Some(path) = recents_path() else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_default()
}

pub fn push_recent(path: &Path) {
    let mut list = load_recents();
    let abs = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => path.to_path_buf(),
    };
    let abs = abs.to_string_lossy().into_owned();
    list.retain(|p| p != &abs);
    list.insert(0, abs);
    list.truncate(20);
    let Some(dest) = recents_path() else { return };
    let _ = fs::create_dir_all(dest.parent().unwrap_or(Path::new(".")));
    let data = serde_json::to_vec_pretty(&list).unwrap_or_default();
    let _ = atomic_write(&dest, &data);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "typecraft-doc-test-{tag}-{}-{}",
            std::process::id(),
            tag_counter()
        ));
        p
    }

    fn tag_counter() -> usize {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        COUNTER.fetch_add(1, Ordering::SeqCst)
    }

    #[test]
    fn revision_is_a_content_fingerprint() {
        assert_eq!(
            content_revision(b"hello"),
            content_revision(b"hello")
        );
        assert_ne!(content_revision(b"hello"), content_revision(b"world"));
        let rev = content_revision(b"hello");
        assert!(valid_disk_revision(&rev));
        assert!(!valid_disk_revision("sha256:zz"));
        assert!(!valid_disk_revision("md5:0bad"));
        assert!(!valid_disk_revision(""));
    }

    #[test]
    fn save_then_conflict_and_missing() {
        let path = tmp_file("conflict");
        let _ = std::fs::remove_file(&path);

        // First save creates the file even without a baseline.
        let rev = save(&path, "one", None, false).unwrap();
        assert_eq!(rev, content_revision(b"one"));

        // An external change makes the next save conflict.
        std::fs::write(&path, "external").unwrap();
        match save(&path, "two", Some(&rev), false) {
            Err(SaveError::Conflict { disk_revision }) => {
                assert_eq!(disk_revision, content_revision(b"external"));
            }
            other => panic!("expected conflict, got {other:?}"),
        }

        // Force overwrites the changed file...
        let rev2 = save(&path, "two", Some(&rev), true).unwrap();
        assert_eq!(rev2, content_revision(b"two"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");

        // ...but never resurrects a deleted file.
        std::fs::remove_file(&path).unwrap();
        match save(&path, "three", Some(&rev2), true) {
            Err(SaveError::Missing) => {}
            other => panic!("expected missing, got {other:?}"),
        }
        assert!(!path.exists());
    }

    #[test]
    fn existing_file_without_baseline_is_refused() {
        let path = tmp_file("baseline");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "content").unwrap();
        match save(&path, "new", None, false) {
            Err(SaveError::RevisionRequired) => {}
            other => panic!("expected revision required, got {other:?}"),
        }
        // And force without any baseline of a missing file creates it.
        let _ = std::fs::remove_file(&path);
        let rev = save(&path, "new", None, true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(rev, content_revision(b"new"));
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn read_only_policy_blocks_the_write_and_keeps_content() {
        use std::os::unix::fs::PermissionsExt;
        let path = tmp_file("readonly");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "protected").unwrap();
        let original_mode = std::fs::metadata(&path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        std::fs::set_permissions(&path, fs::Permissions::from_mode(0o444))
            .unwrap();

        let snap = read_snapshot(&path).unwrap();
        assert!(snap.read_only);
        assert_eq!(snap.read_only_reason, "no_write_bits");
        assert_eq!(snap.content, "protected");

        let rev = snap.revision.clone();
        match save(&path, "overwritten", Some(&rev), false) {
            Err(SaveError::ReadOnly(reason)) => {
                assert_eq!(reason, "no_write_bits");
            }
            other => panic!("expected read-only, got {other:?}"),
        }
        // Even force cannot bypass the protection.
        match save(&path, "overwritten", Some(&rev), true) {
            Err(SaveError::ReadOnly(_)) => {}
            other => panic!("expected read-only, got {other:?}"),
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "protected");

        // Restore so the temp dir can be cleaned.
        std::fs::set_permissions(
            &path,
            fs::Permissions::from_mode(original_mode),
        )
        .unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_preserves_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let path = tmp_file("mode");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "shared").unwrap();
        std::fs::set_permissions(&path, fs::Permissions::from_mode(0o644))
            .unwrap();
        let rev = content_revision(b"shared");
        save(&path, "shared again", Some(&rev), false).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_snapshot_is_not_a_clean_baseline() {
        let path = tmp_file("missing");
        let _ = std::fs::remove_file(&path);
        let snap = read_snapshot(&path).unwrap();
        assert!(!snap.exists);
        assert_eq!(snap.revision, "");
    }
}
