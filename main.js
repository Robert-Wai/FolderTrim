const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const getFolderSize = require('./getfoldersize');
const chokidar = require('chokidar');
const notifier = require('node-notifier');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;
let tray = null;
let fsWatcher = null;
const iconPath = path.join(__dirname, '/images/Folder_grey_16x.png');
const watchedFoldersInfo = {} // {{"C:\temp" : [maxSizeinBytes, currentSizeInBytes]}}
let lastGetFolderSizeTime = Date.now();
function createMainWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: iconPath,
        darkTheme: true,
    });

    // and load the index.html of the app.
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // override default menu
    const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    Menu.setApplicationMenu(mainMenu);

    // Emitted when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        if (fsWatcher) {
            fsWatcher.close();
            fsWatcher = null;
        }
        mainWindow = null;
    });

    // intercept close event to hide window instead
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    // add a tray
    tray = new Tray(iconPath);
    const trayMenu = Menu.buildFromTemplate(trayMenuTemplate);
    tray.setToolTip("FolderTrim");
    tray.setContextMenu(trayMenu);
    tray.on('double-click', () => {
        mainWindow.show();
    });
}

const mainMenuTemplate = [
    {
        label: 'File',
        submenu: [
            {
                label: 'Quit',
                accelerator: 'CmdOrCtrl+Q',
                click() {
                    app.quit();
                }
            }
        ]
    },
    {
        label: 'Dev Tools',
        submenu: [
            {
                label: 'Toggle Developer Tools',
                accelerator: 'F12',
                click(menuItem, activeWindow) {
                    activeWindow.toggleDevTools();
                }
            },
            {
                role: 'reload'
            }
        ]
    }
];

const trayMenuTemplate = [
    {
        label: 'Quit FolderTrim',
        click() {
            app.quit();
        }
    }
]

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createMainWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createMainWindow();
    }
});

app.on('before-quit', () => { app.isQuitting = true });

ipcMain.on('settings:saveRequested', (event, arg) => {
    console.log('save requested with arg: ');
    console.log(arg);

    let folderPath = arg.folderPath;
    console.log(folderPath);
    // initialize file watcher if we haven't
    if (!fsWatcher) {
        fsWatcher = chokidar.watch('file, dir, glob, or array', {
            ignored: /(^|[\/\\])\../,
            ignoreInitial: true,
        });

        fsWatcher
            .on('add', (filePath, stats) => {
                console.log('Added: ' + filePath);

                let containingFolder = path.dirname(filePath);
                let matchingWatchedFolder = folderPath;
                //// calculate by keeping a running total. saves iterations but perhaps not as reliable?
                //Object.keys(watchedFoldersInfo).forEach((key) => {
                //    if (isChildOf(containingFolder, key)) {
                //        watchedFoldersInfo[key][1] += stats.size;
                //        matchingKey = key;
                //        fileToDateAndSize[filePath] = [stats.birthtimeMs, stats.size];
                //    }
                //});

                Object.keys(watchedFoldersInfo).forEach((key) => {
                    if (isChildOf(containingFolder, key)) {
                        matchingWatchedFolder = key;
                    }
                });

                console.log("Getting folder size of " + matchingWatchedFolder);
                getFolderSize(matchingWatchedFolder, (err, size) => {
                    console.log("size: " + size);
                    lastGetFolderSizeTime = Date.now();
                    watchedFoldersInfo[folderPath][1] = size;

                    // update size
                    event.sender.send('folder:sizeChanged', {
                        folderIndex: Object.keys(watchedFoldersInfo).indexOf(matchingWatchedFolder),
                        folder: matchingWatchedFolder,
                        size: toDisplayGB(watchedFoldersInfo[matchingWatchedFolder][1]),
                        maxSize: toDisplayGB(watchedFoldersInfo[matchingWatchedFolder][0])
                    });
                    
                    // notify if we're over limit
                    if (watchedFoldersInfo[matchingWatchedFolder][1] > watchedFoldersInfo[matchingWatchedFolder][0]) {
                        var fileToDateAndSize = populateFileToDateToSize();

                        let diskSpaceToClear = watchedFoldersInfo[matchingWatchedFolder][1] - watchedFoldersInfo[matchingWatchedFolder][0];
                        let sortedFilesByDate = Object.keys(fileToDateAndSize).sort((a, b) => { return fileToDateAndSize[a][0] - fileToDateAndSize[b][0] });
                        let totalFileSize = 0;

                        // calculate number of files to delete. Check from oldest file to new. 
                        let numFilesToDelete = 0;
                        for (var i = 0; i < sortedFilesByDate.length; i++) {
                            let filename = sortedFilesByDate[i];
                            console.log(filename);
                            totalFileSize += fileToDateAndSize[filename][1];
                            numFilesToDelete++;
                            if (totalFileSize >= diskSpaceToClear)
                                break;
                        }

                        notifier.notify({
                            title: 'FolderTrim',
                            icon: iconPath,
                            message: 'Deleting ' + numFilesToDelete + ' files to clear ' + toDisplayGB(totalFileSize) + ' GB'
                        });
                        event.sender.send('folder:deleteScheduled', {
                            folderIndex: Object.keys(watchedFoldersInfo).indexOf(matchingWatchedFolder),
                            filesToBeDeleted: sortedFilesByDate.slice(numFilesToDelete)
                        });
                    }
                });
            })
           // .on('change', (filePath, stats) =>{
           //     console.log('changed: ' +filePath);
           // })
            .on('unlink', filePath => {
                console.log('Deleted: ' + filePath);
                let containingFolder = path.dirname(filePath);
                let matchingWatchedFolder = folderPath;
                Object.keys(watchedFoldersInfo).forEach((key) => {
                    if (isChildOf(containingFolder, key)) {
                        matchingWatchedFolder = key;
                    }
                });

                console.log(matchingWatchedFolder);
                getFolderSize(matchingWatchedFolder, (err, size) => {
                    //   if (err) console.log(err);
                    lastGetFolderSizeTime = Date.now();
                    watchedFoldersInfo[folderPath][1] = size;
                    event.sender.send('folder:sizeChanged', {
                        folderIndex: Object.keys(watchedFoldersInfo).indexOf(matchingWatchedFolder),
                        folder: matchingWatchedFolder,
                        size: toDisplayGB(watchedFoldersInfo[matchingWatchedFolder][1]),
                        maxSize: toDisplayGB(watchedFoldersInfo[matchingWatchedFolder][0])
                    });
                });
            })
            .on('error', error => {
                console.log(error);
            })
            .on('ready', () => {
                console.log('Monitoring for changes.');
            });
    }

    if (Object.keys(fsWatcher.getWatched()).includes(folderPath)) {
        console.log("Already monitoring " + folderPath);
    }
    else {
        if (!Object.keys(watchedFoldersInfo).includes(folderPath))
            watchedFoldersInfo[folderPath] = [arg.maxSize * 1024 * 1024 * 1024, 0];

        fsWatcher.add(folderPath);

        event.sender.send('settings:saved', {
            folderIndex: Object.keys(watchedFoldersInfo).indexOf(folderPath),
            folder: folderPath,
            size: toDisplayGB(watchedFoldersInfo[folderPath][1]),
            maxSize: toDisplayGB(watchedFoldersInfo[folderPath][0])
        });

        getFolderSize(folderPath, (err, size) => {
            lastGetFolderSizeTime = Date.now();
            watchedFoldersInfo[folderPath][1] = size;
            event.sender.send('folder:sizeChanged', {
                folderIndex: Object.keys(watchedFoldersInfo).indexOf(folderPath),
                folder: folderPath,
                size: toDisplayGB(watchedFoldersInfo[folderPath][1]),
                maxSize: toDisplayGB(watchedFoldersInfo[folderPath][0])
            });
        });
    }

});

function isChildOf(child, parent) {
    if (child === parent) return true
    const parentTokens = parent.split(path.sep).filter(i => i.length)
    return parentTokens.every((t, i) => child.split(path.sep)[i] === t)
}

function toDisplayGB(bytes) {
    return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

function populateFileToDateToSize() {
    var watchedItems = fsWatcher.getWatched();
    var returnFileToDateToSize = {};
    for (var folder in watchedItems) {
        var files = watchedItems[folder];
        for (var i = 0; i < files.length; i++) {
            let filePath = path.join(folder, files[i]);
            var stats = fs.lstatSync(filePath);
            if (stats.isFile()) {
                returnFileToDateToSize[filePath] = [stats.birthtimeMs, stats.size];
            }
        }
    }
    console.log(returnFileToDateToSize);
    return returnFileToDateToSize;
}