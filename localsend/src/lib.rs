// Vendored from github.com/localsend/localsend (packages/core). Keep the
// upstream code style intact to ease syncing; silence its clippy lints.
#![allow(
    clippy::needless_borrow,
    clippy::needless_borrows_for_generic_args,
    clippy::too_many_arguments,
    clippy::inherent_to_string,
    clippy::useless_conversion,
    clippy::unnecessary_sort_by,
    clippy::wrong_self_convention,
    clippy::unused_enumerate_index,
    clippy::single_match,
    clippy::redundant_closure,
    clippy::question_mark,
    clippy::option_as_ref_deref,
    clippy::manual_is_multiple_of
)]

#[cfg(feature = "crypto")]
pub mod crypto;
#[cfg(feature = "discovery")]
pub mod discovery;
#[cfg(feature = "http")]
pub mod http;
pub mod model;
#[cfg(feature = "multicast")]
pub mod multicast;
pub mod util;

#[cfg(feature = "http")]
pub use reqwest;
pub use serde_json;
