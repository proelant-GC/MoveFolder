/**
 * 0. Parameters & Menu
 * Global configuration and menu setup.
 */

// --- CONFIGURATION ---
const CONFIG = {
  MASTER_SHEET_ID: '1Jz8vMEc6LPc_bexXp4rpsXp5GfLYVJsRUDGL1bNzft8', // REPLACE THIS
  USER_LIST_STR: 'Users',       // Sheet name for authorized users (Col A)
  LOG_STR: 'Requests',          // High-level User Requests
  SYSTEM_LOG_STR: 'SystemLogs', // Detailed technical logs
  ADMIN_EMAIL: 'drive.migratie@natuurpunt.be', // Email used for fallback errors
  APP_TITLE: 'NP Folder Move',
  API_KEY: 'AIzaSyBYOmk7DxQ6B_CoelXw5x3Tmw8dGn_lfo0', // Required for Google Picker
  PROJECT_NUMBER: '882415892050',
  MY_DRIVE_ALLOWED: false,
  TIME_LIMIT_MS: 25 * 60 * 1000 // 25-minute execution limit for Workspace
};

// --- STATUS ENUMS ---
const STATUS = {
  PENDING: 'IN WACHTRIJ',
  PROCESSING: 'BEZIG',
  SUCCESS: 'VOLTOOID',
  ERROR: 'FOUT'
};

/**
 * Adds a menu to the spreadsheet for administrative tasks.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NP Folder Move')
    .addItem('Start Background Processor', 'processTransferQueue')
    .addToUi();
}