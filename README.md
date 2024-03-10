### d2rmp -- a patcher script toolset for D2R mods

- A TSV diff tool.
- A D2RMM compatible script runner.  
    * Easier to debug compared to D2RMM.
    * `require` and all node APIs exposed to script.
- A save file (d2s/d2i) manipulation tool based on patched 'd2s' library.
    * Export d2s/d2i to JSON or import from JSON.
    * Migrate save file between different txt(excel) mods. (basic support)

#### Requirements
- node.js (possibly 18 LTS or newer)
- Existence of D2RMM (in order to fetch its settings)

#### Usage - diff
`node diff.js <src-dir> <dst-dir>`  
`node diff.js <src-file> [<dst-file>]`  
If dst-file is omitted, it behaves as `node diff.js <src-file> basename(<src-file>)`.

#### Usage - D2RMM mode
`node main.js [CONFIG-FILE.jsonc] [TASK-CONFIG-FILE.jsonc]`
default.jsonc is the CONFIG-FILE template. (also as default config file if omitted)
default_task.jsonc is the TASK-CONFIG-FILE template for D2RMM mode. (also as default task config file if omitted)

#### Usage - Save file mode
`node main.js [CONFIG-FILE.jsonc] [TASK-CONFIG-FILE.jsonc]` (for import/export)
`node main.js [CONFIG-FILE.jsonc] [TASK-CONFIG-FILE.jsonc] [SAVE-FILES]...` (for migrate/patch)
default.jsonc is the CONFIG-FILE template. (also as default config file if omitted)
d2s_task.jsonc is the TASK-CONFIG-FILE template for save file mode.

#### Config file and Task Config file
Refer to config file templates. (JSON with comments)
Most notably, `dry_run` prevents the runner to run without touching (delete/rename/write) any file, and instead print a message.

#### Notes and Caveats
- Running `main.js` requires existence of D2RMM, although it isn't always necessary.  
  This is the result of trying to simulate D2RMM and fetch latest settings (paths, mods enable list and order).
- D2RMM may lock its settings storage (leveldb) without settings modification. Close D2RMM in this case.
- Mostly tested on linux, not on windows.

#### D2RMM mode vs D2RMM difference
- D2RMM has a (weak) sandbox, while D2RMM mode doesn't because I deemed that it makes little sense.  
  Review mod scripts before running.
- When D2RMM reads an input file, it writes it to output even if no script writes it. D2RMM mode avoids such bogus outputs.
- D2RMM may extract files from CASC on-the-fly; D2RMM mode doesn't because it is deemed to have little use -- extracted files are required for diff/merge modifications or migrate save files.

#### Known Issues or Limitations
- Currently, save file migration can handle nothing other than small itemstatcost.txt changes. (e.g. save bits changes)  
  This is due to flawed semantics and implementation of save file handling (d2s library), which needs a total revamp to fix.
- Save file exported JSON format is unstable (semantically), which should only serve as human readable text or transient data.
