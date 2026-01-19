//! Fuzzy file search functionality for the TUI.

use std::fs;
use std::path::{Path, PathBuf};

/// File search popup state.
#[derive(Debug, Clone)]
pub struct FileSearchPopup {
    /// Current search query.
    pub query: String,
    /// List of discovered files.
    pub files: Vec<FileInfo>,
    /// Indices of filtered files (after fuzzy matching).
    pub filtered_indices: Vec<usize>,
    /// Currently selected file index.
    pub selected_index: usize,
    /// Base directory for search.
    pub base_dir: PathBuf,
}

/// File information for search results.
#[derive(Debug, Clone)]
pub struct FileInfo {
    /// Full path to the file.
    pub path: PathBuf,
    /// Relative path from base directory.
    pub relative_path: String,
    /// Whether this is a directory.
    pub is_dir: bool,
}

impl FileSearchPopup {
    /// Create a new file search popup.
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            query: String::new(),
            files: Vec::new(),
            filtered_indices: Vec::new(),
            selected_index: 0,
            base_dir,
        }
    }

    /// Refresh the file list by scanning the base directory (sync version).
    pub fn refresh_files_sync(&mut self) {
        self.files = scan_directory_sync(&self.base_dir, 2);
        self.update_filtered();
    }

    /// Refresh the file list by scanning the base directory (async version).
    pub async fn refresh_files(&mut self) {
        self.files = scan_directory(&self.base_dir, 2).await;
        self.update_filtered();
    }

    /// Update the query with a new character and re-filter.
    pub fn update_query(&mut self, c: char) {
        self.query.push(c);
        self.update_filtered();
    }

    /// Remove the last character from the query and re-filter.
    pub fn remove_char(&mut self) {
        self.query.pop();
        self.update_filtered();
    }

    /// Set the query and re-filter.
    pub fn set_query(&mut self, query: String) {
        self.query = query;
        self.update_filtered();
    }

    /// Update the filtered indices based on the current query.
    pub fn update_filtered(&mut self) {
        if self.query.is_empty() {
            // Show all files when query is empty
            self.filtered_indices = (0..self.files.len()).collect();
        } else {
            self.filtered_indices = fuzzy_match(&self.query, &self.files);
        }
        // Reset selection to first item
        self.selected_index = 0;
    }

    /// Move the selection up or down.
    pub fn move_selection(&mut self, direction: isize) {
        if self.filtered_indices.is_empty() {
            return;
        }

        let len = self.filtered_indices.len();
        self.selected_index = if direction < 0 {
            // Moving up
            if self.selected_index == 0 {
                len - 1
            } else {
                self.selected_index - 1
            }
        } else {
            // Moving down
            (self.selected_index + 1) % len
        };
    }

    /// Get the currently selected file.
    pub fn selected_file(&self) -> Option<&FileInfo> {
        self.filtered_indices
            .get(self.selected_index)
            .and_then(|&idx| self.files.get(idx))
    }

    /// Get the full path of the currently selected file.
    pub fn selected_path(&self) -> Option<PathBuf> {
        self.selected_file().map(|f| f.path.clone())
    }
}

/// Scan directory recursively for files (sync version).
pub fn scan_directory_sync(base_dir: &Path, max_depth: usize) -> Vec<FileInfo> {
    let mut files = Vec::new();
    scan_directory_recursive(base_dir, base_dir, 0, max_depth, &mut files);
    files
}

/// Scan directory recursively for files.
pub async fn scan_directory(base_dir: &Path, max_depth: usize) -> Vec<FileInfo> {
    let mut files = Vec::new();

    // Use tokio for async file scanning
    let base_dir = base_dir.to_path_buf();
    let max_depth = max_depth.clone();

    tokio::task::spawn_blocking(move || {
        scan_directory_recursive(&base_dir, &base_dir, 0, max_depth, &mut files);
        files
    })
    .await
    .unwrap_or_default()
}

/// Recursively scan directory.
fn scan_directory_recursive(
    base_dir: &Path,
    current_dir: &Path,
    current_depth: usize,
    max_depth: usize,
    files: &mut Vec<FileInfo>,
) {
    // Read directory entries
    let entries = match fs::read_dir(current_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files that are just "." or ".."
        if name == "." || name == ".." {
            continue;
        }

        let is_dir = path.is_dir();
        let relative_path = path
            .strip_prefix(base_dir)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        files.push(FileInfo {
            path: path.clone(),
            relative_path,
            is_dir,
        });

        // Recurse into subdirectories if we haven't hit max depth
        if is_dir && current_depth < max_depth {
            scan_directory_recursive(base_dir, &path, current_depth + 1, max_depth, files);
        }
    }
}

/// Fuzzy match files against query, returns sorted indices.
pub fn fuzzy_match(query: &str, files: &[FileInfo]) -> Vec<usize> {
    let mut scores: Vec<(usize, usize)> = Vec::new();

    let query_lower = query.to_lowercase();

    for (idx, file) in files.iter().enumerate() {
        let text = &file.relative_path;
        let text_lower = &text.to_lowercase();

        if let Some(score) = fuzzy_score(&query_lower, text_lower) {
            scores.push((idx, score));
        }
    }

    // Sort by score (descending) and return indices
    scores.sort_by(|a, b| b.1.cmp(&a.1));
    scores.into_iter().map(|(idx, _)| idx).collect()
}

/// Calculate fuzzy match score (higher is better).
/// Returns None if there's no match.
pub fn fuzzy_score(query: &str, text: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(0);
    }

    let mut query_chars = query.chars().peekable();
    let mut text_chars = text.chars().enumerate().peekable();
    let mut score = 0usize;
    let mut prev_match_idx: Option<usize> = None;

    while let Some(qc) = query_chars.next() {
        let mut found = false;

        while let Some((idx, tc)) = text_chars.next() {
            if tc == qc {
                // Found a match

                // Base score for finding the character
                score += 10;

                // Bonus for consecutive matches
                if let Some(prev_idx) = prev_match_idx {
                    if idx == prev_idx + 1 {
                        score += 30; // Consecutive match bonus (increased from 20)
                    } else if idx == prev_idx + 2 {
                        score += 5; // Near-consecutive bonus
                    }
                }

                // Bonus for word boundary matches
                if idx == 0 {
                    score += 15; // Match at start
                } else {
                    // Check if previous character is a separator
                    let prev_char = text.chars().nth(idx - 1);
                    if prev_char.map_or(false, |c| c == '_' || c == '-' || c == '/' || c == '.') {
                        score += 15; // Word boundary bonus
                    }
                }

                prev_match_idx = Some(idx);
                found = true;
                break;
            }
        }

        if !found {
            return None; // Query character not found
        }
    }

    // Bonus for shorter names with same number of matches
    let text_len = text.chars().count();
    if text_len > 0 {
        score += (1000 / text_len).min(10);
    }

    Some(score)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzzy_score_exact_match() {
        let score = fuzzy_score("test", "test");
        assert!(score.is_some());
        assert!(score.unwrap() > 0);
    }

    #[test]
    fn test_fuzzy_score_substring() {
        let score = fuzzy_score("test", "mytestfile");
        assert!(score.is_some());
    }

    #[test]
    fn test_fuzzy_score_consecutive() {
        let consecutive = fuzzy_score("abc", "abc");
        let spaced = fuzzy_score("abc", "a_b_c");

        // Consecutive should score higher than spaced
        assert!(consecutive.unwrap() > spaced.unwrap());
    }

    #[test]
    fn test_fuzzy_score_no_match() {
        let score = fuzzy_score("xyz", "abcdef");
        assert!(score.is_none());
    }

    #[test]
    fn test_fuzzy_score_case_insensitive() {
        // fuzzy_score does case-sensitive comparison
        // fuzzy_match handles case conversion
        let score1 = fuzzy_score("test", "testfile");
        let text_lower = "TESTFILE".to_lowercase();
        let score2 = fuzzy_score("test", &text_lower);

        // Lowercase query should match lowercase text
        assert!(score1.is_some());
        // Lowercase query should match lowercase uppercase text
        assert!(score2.is_some());
    }

    #[test]
    fn test_fuzzy_match_ordering() {
        let files = vec![
            FileInfo {
                path: PathBuf::from("/test/file.rs"),
                relative_path: "test/file.rs".to_string(),
                is_dir: false,
            },
            FileInfo {
                path: PathBuf::from("/abc.rs"),
                relative_path: "abc.rs".to_string(),
                is_dir: false,
            },
            FileInfo {
                path: PathBuf::from("/a_b_c.rs"),
                relative_path: "a_b_c.rs".to_string(),
                is_dir: false,
            },
        ];

        let indices = fuzzy_match("abc", &files);

        // Should get some matches
        assert!(!indices.is_empty());

        // "abc.rs" should rank higher than "a_b_c.rs" (consecutive bonus)
        let abc_idx = files.iter().position(|f| f.relative_path == "abc.rs");
        let spaced_idx = files.iter().position(|f| f.relative_path == "a_b_c.rs");

        if let (Some(abc), Some(spaced)) = (abc_idx, spaced_idx) {
            let abc_pos = indices.iter().position(|&i| i == abc);
            let spaced_pos = indices.iter().position(|&i| i == spaced);

            assert!(abc_pos < spaced_pos);
        }
    }
}
