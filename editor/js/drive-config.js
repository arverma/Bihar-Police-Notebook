/**
 * Google Drive OAuth + folder settings for the editor.
 * Client ID is public by design; never commit a client secret.
 */

export const GOOGLE_CLIENT_ID =
    '1067967935290-g3jib08k9dr31ni5h3slsl1kaq03holo.apps.googleusercontent.com';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Returns the backup folder name for the current environment.
 * - Production (bpdiary.arverma.dev) → canonical prod folder, unchanged.
 * - Staging + localhost              → shared test folder, never touches prod data.
 */
function getDriveFolderName() {
    const host = typeof location !== 'undefined' ? location.hostname : '';
    if (host === 'bpdiary.arverma.dev') {
        return 'Bihar Police Notebook Backup — do not delete';
    }
    return 'Bihar Police Notebook Backup - test';
}

/** Backup folder in My Drive (created if missing). Environment-aware. */
export const DRIVE_FOLDER_NAME = getDriveFolderName();

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
