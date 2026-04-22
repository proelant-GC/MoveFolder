/**
 * 1. Main
 * Handles Web App serving and Frontend-Backend communication.
 */

function doGet(e) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isUserAuthorized(userEmail)) {
    return createHtmlOutput('6. AccessDenied');
  }
  return createHtmlOutput('4. UI');
}

function isUserAuthorized(email) {
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.USER_LIST_STR);
  if (!sheet || sheet.getLastRow() === 0) return false;
  const data = sheet.getRange("A:A").getValues();
  return data.flat().map(u => u.toString().toLowerCase()).includes(email.toLowerCase());
}

/**
 * CHECK COPY PERMISSION
 * Checks Column B of the User sheet for TRUE/FALSE
 */
function getUserCopyPermission() {
  const userEmail = Session.getActiveUser().getEmail();
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.USER_LIST_STR);
  
  if (!sheet || sheet.getLastRow() === 0) return false;

  const data = sheet.getRange("A:B").getValues();
  const userRow = data.find(row => row[0].toString().toLowerCase() === userEmail.toLowerCase());
  
  if (userRow) {
    const permission = userRow[1];
    return permission === true || permission.toString().toUpperCase() === 'TRUE';
  }
  return false;
}

function createHtmlOutput(filename) {
  return HtmlService.createTemplateFromFile(filename)
    .evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * FETCH DRIVES: Returns list of Shared Drives where user is Manager or Content Manager.
 */
function getAuthorizedSharedDrives() {
  let drives = [];
  let pageToken = null;
  try {
    do {
      const response = Drive.Drives.list({
        pageToken: pageToken,
        pageSize: 100,
        q: "hidden = false",
        fields: "nextPageToken, drives(id, name, capabilities)" 
      });
      
      if (response.drives) {
        response.drives.forEach(drive => {
          const caps = drive.capabilities;
          if (caps.canAddChildren && (caps.canDeleteChildren || caps.canTrashChildren)) {
             drives.push({ id: drive.id, name: drive.name });
          }
        });
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  } catch (e) {
    throw new Error("Kon Shared Drives niet laden: " + e.message);
  }
  return drives.sort((a, b) => a.name.localeCompare(b.name));
}

function validateDestinationPermissions(driveId) {
  try {
    const drive = Drive.Drives.get(driveId, { fields: "id, name, capabilities" });
    const caps = drive.capabilities;
    const hasSufficientRights = caps.canAddChildren && (caps.canDeleteChildren || caps.canTrashChildren);

    if (!hasSufficientRights) {
      return { valid: false, error: `Geen toegang: U moet 'Manager' of 'Content Manager' zijn van '${drive.name}'.` };
    }
    return { valid: true, name: drive.name };
  } catch (e) {
    return { valid: false, error: "Validatiefout: " + e.message };
  }
}

/**
 * API: Submit Request
 * Ontvangt nu ook de sourceDriveName om in de eerste email te tonen.
 */
function submitMoveRequest(sourceId, targetId, sourceName, targetName, isCopy, sourceDriveName) {
  const userEmail = Session.getActiveUser().getEmail();
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
  
  if (isCopy) {
    const canCopy = getUserCopyPermission();
    if (!canCopy) isCopy = false; 
  }

  let sheet = ss.getSheetByName(CONFIG.LOG_STR);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_STR);
    sheet.appendRow(['Timestamp', 'User', 'Action', 'SourceID', 'TargetID', 'Status', 'Details', 'Info', 'RequestID']);
  }
  
  if (!sourceId || !targetId) throw new Error("Ongeldige parameters.");

  const actionName = isCopy ? 'Mapkopie' : 'Mapoverdracht';
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'GMT+1', 'yyyyMMdd');
  const uniqueId = 'REQ-' + dateStr + '-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  sheet.appendRow([
    now,
    userEmail,
    actionName,
    sourceId,
    targetId,
    STATUS.PENDING,
    `Bron: ${sourceName} (${sourceDriveName}) -> Doel: ${targetName}`,
    "", 
    uniqueId 
  ]);

  try {
    sendAckEmail(userEmail, uniqueId, sourceName, targetName, isCopy, sourceDriveName);
  } catch (e) {
    console.warn("Failed to send ack email: " + e.message);
  }
  
  return {
    success: true,
    message: isCopy ? "Kopieerverzoek succesvol ingediend." : "Verplaatsingsverzoek succesvol ingediend.",
    requestId: uniqueId
  };
}

function sendAckEmail(to, requestId, sourceName, targetName, isCopy, sourceDriveName) {
  const actionText = isCopy ? "Kopieeractie" : "Mapoverdracht";
  const subject = `Verzoek Ontvangen: ${actionText} (${requestId})`;

  const template = HtmlService.createTemplateFromFile('8. EmailTemplate');
  
  template.statusTitle = "✔ Verzoek Ontvangen";
  template.statusColor = "#1a73e8"; 
  template.statusMessage = `Uw verzoek tot ${actionText} is goed ontvangen en in de wachtrij geplaatst.<br>U ontvangt een tweede e-mail zodra de actie voltooid is.`;
  template.errorMsg = null;
  
  template.isCopy = isCopy;
  template.requestId = requestId;
  
  // Update Source: We gebruiken nu de correcte drive naam in plaats van 'Bron'
  template.source = { name: sourceName, id: "Zie detail bij verwerking", drive: sourceDriveName || "Onbekend" };
  template.target = { name: targetName, id: "Zie detail bij verwerking" };

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: template.evaluate().getContent()
  });
}

function getOAuthToken() { return ScriptApp.getOAuthToken(); }
function getApiKey() { return CONFIG.API_KEY; }
function getProjectNumber() { return CONFIG.PROJECT_NUMBER; }
function getMyDriveAllowed() { return CONFIG.MY_DRIVE_ALLOWED; }