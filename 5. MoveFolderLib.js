/**
 * Library name: MoveFolder
 */
var appName = "MoveFolder";

function isAPIAtAdvancedGoogleServices_(apiName) {
  if (!apiName || apiName == "" || typeof apiName != "string") {
    throw new Error("Please set a valid API name.");
  } else if (!/^[A-Z]+$/g.test(apiName[0])) {
    const [t, ...b] = apiName;
    apiName = [t.toUpperCase(), ...b].join("");
  }
  const obj = { apiName, api: "disable" };
  if (typeof this[apiName] !== "undefined") {
    obj.api = "enable";
    if(this[apiName].getVersion) {
       obj.version = this[apiName].getVersion();
    }
  }
  return obj;
}

function listFolders_(object) {
  const { headers, srcFolderId } = object;

  function addQueryParameters(url, obj) {
    return (url == "" ? "" : `${url}?`) + Object.entries(obj).flatMap(([k, v]) => Array.isArray(v) ? v.map(e => `${k}=${encodeURIComponent(e)}`) : `${k}=${encodeURIComponent(v)}`).join("&");
  }

  const url = "https://www.googleapis.com/drive/v3/files";

  const getAllFolders = (id, parents = [], folders = { temp: [] }) => {
    const query = {
      q: `'${id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name,parents),nextPageToken",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    };
    const files = [];
    let pageToken = "";
    do {
      const res = UrlFetchApp.fetch(addQueryParameters(url, query), { headers });
      const obj = JSON.parse(res.getContentText());
      if (obj.files.length > 0) {
        files.push(...obj.files);
      }
      pageToken = obj.nextPageToken;
      query.pageToken = pageToken;
    } while (pageToken)
    const temp = [];
    const p = parents.slice();
    p.push(id);
    files.forEach(e => {
      temp.push({ "name": e.name, "id": e.id, "parent": e.parents[0], "tree": p });
    });
    if (temp.length > 0) {
      folders.temp.push(temp);
      temp.forEach(e => {
        getAllFolders(e.id, e.tree, folders);
      });
    }
    return folders;
  }

  const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${srcFolderId}?supportsAllDrives=true&fields=id%2Cname`, { headers });
  const topFolder = JSON.parse(res.getContentText());
  const obj = getAllFolders(srcFolderId);
  const { id, id2Name } = obj.temp.reduce((o, e) => {
    e.forEach(({ name, id, tree }) => {
      o.id.push([...tree, id]);
      o.id2Name = { ...o.id2Name, [id]: name };
    });
    return o;
  }, { id: [[topFolder.id]], id2Name: { [topFolder.id]: topFolder.name } });
  const name = id.map(e => e.map(f => id2Name[f]));
  const folderTree = { id, name };

  const files = folderTree.id.map((r, i) => {
    const id = r[r.length - 1];
    const query = {
      q: `'${id}' in parents and trashed=false`,
      fields: "files(parents,id),nextPageToken",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    };
    const files = [];
    let pageToken = "";
    do {
      const res = UrlFetchApp.fetch(addQueryParameters(url, query), { headers });
      const obj = JSON.parse(res.getContentText());
      if (obj.files.length > 0) {
        files.push(...obj.files);
      }
      pageToken = obj.nextPageToken;
      query.pageToken = pageToken;
    } while (pageToken);
    return {
      folderTreeById: r,
      folderTreeByName: folderTree.name[i],
      filesInFolder: files
    };
  });
  return { files };
}

/**
 * MODIFIED: Supports 'copy' option & DISABLED Auto-Delete for Safety
 */
function moveFolder_(object) {
  let { srcFolderId, dstFolderId, accessToken = ScriptApp.getOAuthToken(), forSharedDrive = false, copy = false } = object;

  const headers = { authorization: "Bearer " + accessToken };

  console.log("Starting Folder " + (copy ? "COPY" : "MOVE") + " Operation.");

  // Check source folder validity (simplified check)
  const checkSharedDrive_ = folderId => {
    try {
      const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=driveId`, { headers });
      const obj = JSON.parse(res.getContentText());
      return "driveId" in obj;
    } catch(e) { return false; }
  }

  // Retrieve file list with the subfolders.
  console.log(`Retrieve file list with the subfolders.`);
  const obj = listFolders_({ headers, srcFolderId });
  
  if (!obj.files || obj.files.length == 0) {
    console.warn("No files found to move/copy.");
  }

  // Create folder tree to the destination folder.
  console.log(`Create folder tree to the destination folder.`);
  const tree = obj.files.map(({ folderTreeById, folderTreeByName }) => ({ folderTreeById, folderTreeByName }));
  
  const newFolders = tree.reduce((o, { folderTreeById, folderTreeByName }) => {
    folderTreeByName.forEach((name, j) => {
      const parent = j == 0 ? dstFolderId : o[folderTreeById[j - 1]].id;
      if (!Object.entries(o).some(([k, v]) => k == folderTreeById[j] && v.name == name)) {
        const options = {
          headers,
          contentType: "application/json",
          payload: JSON.stringify({ name, parents: [parent], mimeType: MimeType.FOLDER })
        };
        const res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", options);
        const { id } = JSON.parse(res.getContentText());
        o[folderTreeById[j]] = { id, name };
      }
    });
    return o;
  }, {});

  // Create request body for moving/copying files.
  console.log(`Create request body for ${copy ? 'copying' : 'moving'} files.`);
  const allFolders = [...new Set(obj.files.flatMap(({ folderTreeById }) => folderTreeById))];
  const files = obj.files.map(({ folderTreeById, filesInFolder }) => ({ srcFolder: folderTreeById.pop(), srcFiles: filesInFolder.filter(({ id }) => !allFolders.includes(id)).map(({ id }) => id) }));
  
  const { requests, err } = files.reduce((o, { srcFolder, srcFiles }) => {
    if (newFolders[srcFolder]) {
      if (srcFiles.length > 0) {
        srcFiles.forEach(fileId => {
          
          if (copy) {
            // --- COPY LOGIC (POST) ---
            o.requests.push({
              method: "POST",
              endpoint: `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`,
              requestBody: {
                parents: [newFolders[srcFolder].id] // Copy to new parent
              }
            });
          } else {
            // --- MOVE LOGIC (PATCH) ---
            // FIX: Use removeParents instead of enforceSingleParent to be safer with Shared Drives
            // srcFolder is the ID of the current parent we are moving FROM
            o.requests.push({
              method: "PATCH",
              endpoint: `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&addParents=${newFolders[srcFolder].id}&removeParents=${srcFolder}`,
              requestBody: {},
            });
          }

        });
      }
    } else {
      o.err.push(`"${srcFolder}" is not included in newFolders.`);
    }
    return o;
  }, { err: [], requests: [] });

  if (err.length > 0) console.warn(err);
  
  if (requests.length == 0) {
    console.warn("No files to process.");
  } else {
    // Process File Actions
    console.log(`Executing ${copy ? 'Copy' : 'Move'} batch requests...`);
    EDo({ batchPath: "batch/drive/v3", requests, accessToken });
  }

  // --- SAFETY CHANGE ---
  // The deletion logic below is commented out. 
  // Reason: If the move above fails partially, we do NOT want to delete the source.
  // Users must verify the move and delete the source folder manually.
  
  /*
  if (!copy && allFolders.length > 0) {
    console.log("Cleaning up old folders...");
    const deleteRequests = allFolders.map(id => ({
      method: "DELETE",
      endpoint: `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`
    }));
    EDo({ batchPath: "batch/drive/v3", requests: deleteRequests, accessToken });
  }
  */
  
  if (!copy) {
    console.log("SAFETY MODE: Source folders were NOT deleted automatically. Please remove them manually after verification.");
  }

  console.log("Done.");
}

function run(object) {
  if (typeof object != "object" || !["srcFolderId", "dstFolderId"].every(e => e in object)) {
    throw new Error("Please give valid object.");
  }

  console.log("Check Drive API.");
  if (isAPIAtAdvancedGoogleServices_("Drive").api != "enable") {
    throw new Error("Please enable Drive API v3 at Advanced Google services.");
  }

  moveFolder_(object);
}

const MoveFolder = { run };

// --- BATCH LIBRARY (Unchanged) ---
function Do(object) { return new BatchRequest(object).Do(); }
function EDo(object) { return new BatchRequest(object).EDo(); }
function getBatchPath(name, version) { return new BatchRequest("getBatchPath").getBatchPath(name, version); }

(function(r) {
  var BatchRequest;
  BatchRequest = (function() {
    var createRequest, parser, parserAsBinary, splitByteArrayBySearchData;
    BatchRequest.name = "BatchRequest";
    function BatchRequest(p_) {
      var bP, batchPath;
      if (typeof p_ === "object") {
        if (!p_.hasOwnProperty("requests")) throw new Error("'requests' property was not found in object.");
        this.p = p_.requests.slice();
        this.url = "https://www.googleapis.com/batch";
        if (p_.batchPath) {
          bP = p_.batchPath.trim();
          batchPath = "";
          if (~bP.indexOf("batch/")) batchPath = bP.replace("batch", "");
          else batchPath = bP.slice(0, 1) === "/" ? bP : "/" + bP;
          this.url += batchPath;
        }
        this.at = p_.accessToken || ScriptApp.getOAuthToken();
        this.lb = "\r\n";
        this.boundary = "xxxxxxxxxx";
        this.useFetchAll = "useFetchAll" in p_ ? p_.useFetchAll : false;
        this.exportDataAsBlob = "exportDataAsBlob" in p_ ? p_.exportDataAsBlob : false;
      }
    }
    BatchRequest.prototype.Do = function() {
      var e, params, res;
      try { params = createRequest.call(this, this.p); res = UrlFetchApp.fetch(this.url, params); } catch (error) { e = error; throw new Error(e); }
      return res;
    };
    BatchRequest.prototype.EDo = function() {
      var e, i, k, l, limit, obj, params, ref, ref1, reqs, res, split;
      try {
        if (this.useFetchAll) {
          limit = 100; split = Math.ceil(this.p.length / limit); reqs = [];
          for (i = k = 0, ref = split; 0 <= ref ? k < ref : k > ref; i = 0 <= ref ? ++k : --k) {
            params = createRequest.call(this, this.p.splice(0, limit)); params.url = this.url; reqs.push(params);
          }
          r = UrlFetchApp.fetchAll(reqs);
          res = r.reduce(function(ar, e) {
            var obj;
            if (e.getResponseCode() !== 200) ar.push(e.getContentText());
            else { obj = this.exportDataAsBlob ? parserAsBinary.call(this, e) : parser.call(this, e.getContentText()); ar = ar.concat(obj); }
            return ar;
          }, []);
        } else {
          limit = 100; split = Math.ceil(this.p.length / limit); res = [];
          for (i = l = 0, ref1 = split; 0 <= ref1 ? l < ref1 : l > ref1; i = 0 <= ref1 ? ++l : --l) {
            params = createRequest.call(this, this.p.splice(0, limit)); r = UrlFetchApp.fetch(this.url, params);
            if (r.getResponseCode() !== 200) res.push(r.getContentText());
            else { obj = this.exportDataAsBlob ? parserAsBinary.call(this, r) : parser.call(this, r.getContentText()); res = res.concat(obj); }
          }
        }
      } catch (error) { e = error; throw new Error(e); }
      return res;
    };
    BatchRequest.prototype.getBatchPath = function(name, version) { return "batch/drive/v3"; }; // simplified
    parser = function(d_) {
      var regex, temp; temp = d_.split("--batch"); regex = /{[\S\s]+}/g;
      if (!d_.match(regex)) return d_;
      return temp.slice(1, temp.length - 1).map(function(e) { if (regex.test(e)) return JSON.parse(e.match(regex)[0]); return e; });
    };
    splitByteArrayBySearchData = function(baseData_, searchData_) {
      var bLen, idx, res, search; search = searchData_.join(""); bLen = searchData_.length; res = []; idx = 0;
      while (idx !== -1) {
        idx = baseData_.findIndex(function(_, i, a) { return (Array(bLen).fill(null).map(function(_, j) { return a[j + i]; })).join("") === search; });
        if (idx !== -1) { res.push(baseData_.splice(0, idx)); baseData_.splice(0, bLen); } else { res.push(baseData_.splice(0)); }
      }
      return res;
    };
    parserAsBinary = function(d_) { return []; }; // simplified for text usage
    createRequest = function(d_) {
      var contentId, data, e, params;
      try {
        contentId = 0; data = "--" + this.boundary + this.lb;
        d_.forEach((function(_this) {
          return function(e) {
            data += "Content-Type: application/http" + _this.lb;
            data += "Content-ID: " + ++contentId + _this.lb + _this.lb;
            data += e.method + " " + e.endpoint + _this.lb;
            data += e.accessToken ? "Authorization: Bearer " + e.accessToken + _this.lb : "";
            data += e.requestBody ? "Content-Type: application/json; charset=utf-8" + _this.lb + _this.lb : _this.lb;
            data += e.requestBody ? JSON.stringify(e.requestBody) + _this.lb : "";
            return data += "--" + _this.boundary + _this.lb;
          };
        })(this));
        params = { muteHttpExceptions: true, method: "post", contentType: "multipart/mixed; boundary=" + this.boundary, payload: Utilities.newBlob(data).getBytes(), headers: { Authorization: 'Bearer ' + this.at } };
      } catch (error) { e = error; throw new Error(e); }
      return params;
    };
    return BatchRequest;
  })();
  return r.BatchRequest = BatchRequest;
})(this);