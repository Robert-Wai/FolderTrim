const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const getFolderSize = require('get-folder-size');
const chokidar = require('chokidar');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow = null;
let tray = null;
let fsWatcher = null;
const iconPath = path.join(__dirname, '/images/Folder_grey_16x.png');

function createMainWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: iconPath,
        darkTheme: true
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
        fsWatcher.close();
        fsWatcher = null;
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
    console.log('save requested');
    console.log(arg);

    let folderPath = arg.folderPath;
    getFolderSize(folderPath, (err, size) => {
        if (err) throw err;
        console.log(size);
        event.sender.send('settings:saved', size);
    })

    //chokidar.watch(folderPath, { ignored: /(^|[\/\\])\../ }).on('all', (fileEvent, path) => {
    //    event.sender.send('settings:saved', {
    //        event: fileEvent,
    //        filepath: path
    //    });
    //});
    fsWatcher = chokidar.watch('file, dir, glob, or array', {
        ignored: /(^|[\/\\])\../,
        ignoreInitial: true,
    });

    fsWatcher.on('add', (addArgs) => {
        console.log(addArgs);
        event.sender.send('settings:saved', addArgs);
    });

    // report when ready
    fsWatcher.on('ready', () => {
        console.log("WATCHER READY");
    });
});
