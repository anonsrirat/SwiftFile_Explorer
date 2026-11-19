//! Windows DPAPI-backed encoding for secrets at rest.
//!
//! Secrets never touch SQLite, logs or JSON in plain text: they are encrypted
//! with the current Windows user's DPAPI key and only the base64 blob is stored.

use crate::error::{AppError, AppResult};

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::ptr;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    fn blob_out(blob: &DataBlob) -> Vec<u8> {
        unsafe { std::slice::from_raw_parts(blob.pb_data, blob.cb_data as usize).to_vec() }
    }

    pub fn protect(plain: &str) -> AppResult<String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let mut input = plain.as_bytes().to_vec();
        let data_in = DataBlob {
            cb_data: input.len() as u32,
            pb_data: input.as_mut_ptr(),
        };
        let mut data_out = DataBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &data_in,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
        };
        if ok == 0 {
            return Err(AppError::new(
                "crypto_error",
                "Windows DPAPI could not encrypt the secret",
            ));
        }
        let out = blob_out(&data_out);
        unsafe {
            LocalFree(data_out.pb_data as *mut c_void);
        }
        Ok(STANDARD.encode(out))
    }

    pub fn unprotect(encoded: &str) -> AppResult<String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let mut raw = STANDARD
            .decode(encoded.trim())
            .map_err(|_| AppError::new("crypto_error", "Stored secret is malformed"))?;
        let data_in = DataBlob {
            cb_data: raw.len() as u32,
            pb_data: raw.as_mut_ptr(),
        };
        let mut data_out = DataBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &data_in,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
        };
        if ok == 0 {
            return Err(AppError::new(
                "crypto_error",
                "Windows DPAPI could not decrypt the stored secret (different Windows user?)",
            ));
        }
        let out = blob_out(&data_out);
        unsafe {
            LocalFree(data_out.pb_data as *mut c_void);
        }
        String::from_utf8(out)
            .map_err(|_| AppError::new("crypto_error", "Secret is not valid UTF-8"))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn protect(_plain: &str) -> AppResult<String> {
        Err(AppError::new(
            "unsupported",
            "Secure credential storage is only implemented for Windows builds",
        ))
    }

    pub fn unprotect(_encoded: &str) -> AppResult<String> {
        Err(AppError::new(
            "unsupported",
            "Secure credential storage is only implemented for Windows builds",
        ))
    }
}

pub fn protect(plain: &str) -> AppResult<String> {
    platform::protect(plain)
}

pub fn unprotect(encoded: &str) -> AppResult<String> {
    platform::unprotect(encoded)
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn round_trips_secret() {
        let encoded = super::protect("p@ssw0rd-with-üñïçødé").expect("encrypt");
        assert!(
            !encoded.contains("p@ssw0rd"),
            "ciphertext must not contain plaintext"
        );
        let decoded = super::unprotect(&encoded).expect("decrypt");
        assert_eq!(decoded, "p@ssw0rd-with-üñïçødé");
    }

    #[cfg(windows)]
    #[test]
    fn rejects_garbage() {
        assert!(super::unprotect("not-base64-at-all!!").is_err());
    }
}
