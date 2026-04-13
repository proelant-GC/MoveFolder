/**
 * 2. Backend Processing
 * This script runs on a Time-Driven Trigger (as Super Admin).
 * It processes the Queue from the 'Requests' sheet.
 */
function processTransferQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; 

  const ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.LOG_STR); // 'Requests'
  
  if (!sheet || sheet.getLastRow() <= 1) {
    lock.releaseLock();
    return;
  }

  const data = sheet.getDataRange().getValues();
  const startTime = new Date().getTime();
  const TIME_LIMIT = 5 * 60 * 1000; 
  
  for (let i = 1; i < data.length; i++) {
    if (new Date().getTime() - startTime > TIME_LIMIT) {
      console.log("Time limit approaching. Stopping.");
      break; 
    }

    const row = data[i];
    const status = row[5]; 
    const requestId = row[8] || "NO-ID"; 

    if (status === STATUS.PENDING) {
      sheet.getRange(i + 1, 6).setValue(STATUS.PROCESSING); 
      SpreadsheetApp.flush();

      logToSystem(requestId, "STARTED", "Processing started for " + row[1]);

      const requestorEmail = row[1];
      const sourceId = row[3];
      const targetId = row[4];
      const action = row[2]; 
      const isCopyOperation = (action === 'Mapkopie');

      let sourceMeta = { id: sourceId, name: 'Onbekend', drive: 'Onbekend' };
      let targetMeta = { id: targetId, name: 'Onbekend (Shared Drive)' };

      try {
        const sFile = Drive.Files.get(sourceId, { fields: 'name, driveId, owners', supportsAllDrives: true });
        sourceMeta.name = sFile.name;
        sourceMeta.drive = sFile.driveId ? "Shared Drive" : "My Drive";
        
        const tDrive = Drive.Drives.get(targetId, {fields: 'name'});
        targetMeta.name = tDrive.name;
      } catch (e) {
        logToSystem(requestId, "WARN", "Metadata fetch failed: " + e.message);
      }

      try {
        performMoveLogic(sourceId, targetId, isCopyOperation, requestId);
        
        sheet.getRange(i + 1, 6).setValue(STATUS.SUCCESS); 
        sheet.getRange(i + 1, 8).setValue("Succesvol verwerkt."); 
        
        logToSystem(requestId, "SUCCESS", "Operation completed successfully.");
        sendNotification(requestorEmail, true, null, isCopyOperation, sourceMeta, targetMeta, requestId);
        
      } catch (e) {
        const errorMsg = e.message;
        console.error(`Error ${requestId}: ${errorMsg}`);
        
        sheet.getRange(i + 1, 6).setValue(STATUS.ERROR); 
        sheet.getRange(i + 1, 8).setValue(errorMsg);     
        
        logToSystem(requestId, "ERROR", errorMsg);
        sendNotification(requestorEmail, false, errorMsg, isCopyOperation, sourceMeta, targetMeta, requestId);
      }
    }
  }
  
  cleanSystemLogs(ss);
  lock.releaseLock();
}

function performMoveLogic(sourceId, targetId, isCopy, requestId) {
  logToSystem(requestId, "INFO", `Starting ${isCopy ? 'Copy' : 'Move'}: ${sourceId} to ${targetId}`);
  
  const file = Drive.Files.get(sourceId, { fields: 'id, name, mimeType', supportsAllDrives: true });
  if (!file) throw new Error("Bronmap niet gevonden.");

  MoveFolder.run({
    srcFolderId: sourceId,
    dstFolderId: targetId,
    accessToken: ScriptApp.getOAuthToken(),
    forSharedDrive: true,
    copy: isCopy
  });
}

function logToSystem(requestId, type, message) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    let sheet = ss.getSheetByName(CONFIG.SYSTEM_LOG_STR);
    
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SYSTEM_LOG_STR);
      sheet.appendRow(['Timestamp', 'RequestID', 'Type', 'Message']);
      sheet.setColumnWidth(1, 150);
      sheet.setColumnWidth(2, 150);
      sheet.setColumnWidth(4, 500);
    }
    
    sheet.appendRow([new Date(), requestId, type, message]);
  } catch (e) {
    console.error("System logging failed: " + e.message);
  }
}

function cleanSystemLogs(ss) {
  try {
    const sheet = ss.getSheetByName(CONFIG.SYSTEM_LOG_STR);
    if (!sheet) return;
    
    const maxRows = 25000;
    const lastRow = sheet.getLastRow();
    
    if (lastRow > maxRows) {
      const rowsToDelete = lastRow - maxRows;
      if (rowsToDelete > 0) {
        sheet.deleteRows(2, rowsToDelete);
        console.log(`Cleaned up ${rowsToDelete} rows from SystemLogs.`);
      }
    }
  } catch (e) {
    console.error("Cleanup failed: " + e.message);
  }
}

/**
 * Sends detailed HTML email notification using the template file
 */
function sendNotification(to, success, errorMsg, isCopy, source, target, requestId) {
  const actionText = isCopy ? "Kopieeractie" : "Mapoverdracht";
  const actionVerb = isCopy ? "gekopieerd" : "verplaatst";
  
  const subject = success 
    ? `✅ ${actionText} Succesvol (${requestId})` 
    : `❌ Fout bij ${actionText} (${requestId})`;

  const template = HtmlService.createTemplateFromFile('8. EmailTemplate');
  
  // Set Dynamic Status Variables for the Template
  if (success) {
    template.statusTitle = "✔ Succesvol Voltooid";
    template.statusColor = "#94c11f"; // Natuurpunt Green
    template.statusMessage = `Uw map is succesvol ${actionVerb}. U kunt de bestanden nu terugvinden op de nieuwe locatie.`;
  } else {
    template.statusTitle = "! Er is een fout opgetreden";
    template.statusColor = "#d32f2f"; // Red
    template.statusMessage = "Het systeem kon uw map niet verwerken. Zie de details hieronder.";
  }

  template.errorMsg = errorMsg;
  template.isCopy = isCopy;
  template.source = source;
  template.target = target;
  template.requestId = requestId; 

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: template.evaluate().getContent()
  });
}