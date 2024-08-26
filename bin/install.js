#!/usr/bin/env node

import childProcess from "node:child_process";

// npm install --platform=linux --arch=x64 sharp

// (node install/libvips && node install/dll-copy && prebuild-install) || (node install/can-compile && node-gyp rebuild && node install/dll-copy)

if ( process.platform === "win32" ) {
    const res = childProcess.spawnSync( "node install/libvips && node install/dll-copy && prebuild-install", null, {
        "shell": true,
        "cwd": "node_modules/sharp",
        "stdio": "inherit",
    } );

    process.exit( res.status );
}
