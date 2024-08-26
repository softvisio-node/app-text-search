#!/usr/bin/env node

import childProcess from "node:child_process";

if ( process.platform === "win32" ) {
    const res = childProcess.spawnSync();

    process.exit( res.status );
}
