#!/usr/bin/env node

import childProcess from "node:child_process";

// install sharp linux deps
if ( process.platform === "win32" ) {
    const res = childProcess.spawnSync( "node install/libvips && node install/dll-copy && prebuild-install", null, {
        "shell": true,
        "cwd": "node_modules/sharp",
        "stdio": "inherit",
        "env": {
            ...process.env,
            "npm_config_platform": "linux",
            "npm_config_arch": "x64",
        },
    } );

    process.exit( res.status );
}
