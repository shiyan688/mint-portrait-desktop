# Installer path regression, 0.1.1

## Diagnosis

The installer called the NSIS instruction `GetFullPathName $INSTDIR "$INSTDIR"` before validating the path. NSIS 3.11's instruction is not a plain wrapper around the similarly named Win32 API: its runtime checks for an existing path and can clear the output and set the error flag when the requested directory does not exist. The new default application directory therefore became an empty string. The following `StrLen < 6` check incorrectly displayed the disk-root warning. The visible directory field was not evidence that the variable still contained that value.

The instruction copies its input into an internal buffer before writing the output. Using the same NSIS variable for input and output was not, by itself, the cause. The fixed code nevertheless uses separate input/candidate values so failed validation never overwrites the user's selection.

Primary references:

- [NSIS GetFullPathName reference](https://nsis.sourceforge.io/Reference/GetFullPathName)
- [NSIS 3.11 runtime source, EW_GETFULLPATHNAME](https://github.com/NSIS-Dev/nsis/blob/v311/Source/exehead/exec.c#L450-L474)
- [Microsoft GetFullPathNameW contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfullpathnamew)
- [NSIS 3.11 FileFunc implementation](https://github.com/NSIS-Dev/nsis/blob/v311/Include/FileFunc.nsh)

## Fix reviewed

- Reject relative, drive-relative, UNC and device paths before normalization.
- Call Unicode Win32 `GetFullPathNameW` with distinct input/output storage. Its documented behavior does not require the destination to exist.
- Check zero and capacity-or-greater return values before reading the result.
- Keep the original selection on failure; assign `$INSTDIR` only after safety validation succeeds.
- Trim trailing separators, rejecting actual roots rather than all short paths. Dedicated folders such as `C:\A` are not disk roots.
- Preserve protected-folder and ancestor reparse-point checks, empty-destination checks, and register values.
- Make no filesystem changes while validating the directory page.

## Executed regression tests

Run from the source root:

```
node --test tests/installer-path-behavior.test.cjs tests/installer-audit-safety.test.cjs
```

Result at review: **95 passed, 0 failed**, comprising **82 source-executing behavioral tests** and **13 existing static/package safety checks**.

The behavioral harness reads the current `installer/MintPortrait.nsi` directly, instantiates both installer and uninstaller validator functions, and executes their supported NSIS instructions, branches, labels, function calls and stack operations. Unknown instructions fail the test instead of being silently ignored. The validator policy is not separately reimplemented in JavaScript.

The native and library boundaries are explicit mocks: filesystem attributes and enumeration, Win32 lexical path normalization, NSIS's historical built-in normalization behavior, and FileFunc path helpers. The before-fix fixture is a negative control: a new default directory reproduces the exact erroneous root warning and an empty `$INSTDIR`, while an already-existing directory succeeds. This distinguishes the existence behavior from self-aliasing.

Covered cases include:

- New default and nested directories, existing empty destinations, Unicode names, spaces, and short dedicated folders.
- Trailing separators, forward separators, dot and dot-dot normalization.
- Roots and aliases that resolve to roots; relative, drive-relative, UNC and device paths.
- Protected shell directories, case differences, trailing separators and dot-dot aliases.
- Native normalization failure and buffer overflow without using poisoned output or losing the original path.
- Reparse points at the target and ancestors, including a nonexistent leaf under a reparse parent.
- Scratch-register preservation on success and rejection.
- File targets and nonempty folders; search handles closed after enumeration.
- Read-only directory validation, with no create/write/delete/rename commands or mutating native APIs.

## Limits and required Windows acceptance

These tests ran on Linux with mocked native API boundaries. **They are not Windows execution, Wine execution, UI acceptance, or proof of installation/launch/uninstallation on Windows.** Node's Win32 path normalization is used only for the listed lexical test cases; it is not a complete implementation of Windows path semantics, ACLs, short-name expansion, devices, or filesystem races.

A Windows acceptance run still needs to cover the actual directory page, changing paths and going Back/Next, cancelling before installation, successful default installation, application launch, uninstall, and the real root/nonempty/reparse rejection paths. Do not bypass operating-system security warnings to perform this acceptance.
