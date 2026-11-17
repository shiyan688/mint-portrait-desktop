Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!addplugindir /x86-unicode "../tools/nsis/resources/plugins/x86-unicode"
!include "generated/verify.nsh"
!include "generated/remove.nsh"
!include "generated/directory-guards.nsh"

!define PRODUCT "薄荷人像 Desktop 开发候选版"
!define VERSION "0.2.9"
!define PRODUCT_ID "MintPortrait.Desktop"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MintPortrait.Desktop"
!define RUNTIME_URL "https://github.com/electron/electron/releases/download/v45.0.0/electron-v45.0.0-win32-x64.zip"
!define RUNTIME_SHA "ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47"
Name "${PRODUCT} ${VERSION}"
!ifdef OFFLINE
  OutFile "out/MintPortrait-Offline-Setup.exe"
  !define MODE_TEXT "完整离线安装，不需要联网。"
!else
  OutFile "out/MintPortrait-Setup.exe"
  !define MODE_TEXT "安装时需联网下载约158 MB官方运行组件，并验证SHA-256；安装后修图离线运行。"
!endif
InstallDir "$LOCALAPPDATA\Programs\MintPortrait"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ShowInstDetails show
ShowUninstDetails show
BrandingText "Mint Portrait · 本地人像工作台"
Icon "../assets/icon.ico"
UninstallIcon "../assets/icon.ico"
VIProductVersion "0.2.9.0"
VIAddVersionKey /LANG=2052 "ProductName" "薄荷人像安装程序"
VIAddVersionKey /LANG=2052 "FileDescription" "薄荷人像 Desktop Setup"
VIAddVersionKey /LANG=2052 "FileVersion" "0.2.9.0"
VIAddVersionKey /LANG=2052 "ProductVersion" "0.2.9"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Mint Portrait"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装薄荷人像 Desktop"
!define MUI_WELCOMEPAGE_TEXT "为当前用户安装，无需管理员权限。$\r$\n$\r$\n${MODE_TEXT}$\r$\n$\r$\n本版本未签名，尚未进行 Windows 真机验收。遇到系统安全拦截请停止并反馈，不绕过警告。$\r$\n$\r$\n只支持安装到新建或空文件夹。重装请先卸载旧版。照片与导出文件不会被上传。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "薄荷人像已安装"
!define MUI_FINISHPAGE_TEXT "可从开始菜单启动薄荷人像。$\r$\n$\r$\n此开发候选版未完成美颜质量验收。关闭前请正式保存工程。本机恢复草稿默认关闭，开启后仍不代替正式保存。$\r$\n$\r$\n可在 Windows 设置 → 应用中卸载。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\MintPortrait.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_RUN_TEXT "现在启动薄荷人像"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Var Stage
Var StageOwned
Var Committed
Var Failure
Var Parent
Var Probe
Var Handle
Var Entry
Var DesktopCreated
Var StartCreated
Var UninstallCreated
Var DeleteFailed
Var Mutex
Var PathInput
Var PathCandidate

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "需要64位 Windows 10或11。"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "需要 Windows 10或11。"
    Abort
  ${EndIf}
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\MintPortrait.Desktop.Setup") p .r0 ?e'
  Pop $1
  StrCpy $Mutex $0
  ${If} $1 = 183
    MessageBox MB_OK|MB_ICONEXCLAMATION "另一个薄荷人像安装程序正在运行，请先关闭它。"
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "${REGKEY}" "InstallLocation"
  ${If} $0 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到薄荷人像的安装记录。请先在 Windows 设置 → 应用中卸载旧版，再运行安装。"
    Abort
  ${EndIf}
  StrCpy $StageOwned "0"
  StrCpy $Committed "0"
  StrCpy $DesktopCreated "0"
  StrCpy $StartCreated "0"
  StrCpy $UninstallCreated "0"
FunctionEnd

!macro SafePathFunction PREFIX
Function ${PREFIX}CheckSafePath
  ; NSIS GetFullPathName clears its result for a non-existent path. Do not use it here.
  ; Win32 GetFullPathNameW is lexical and accepts a new installation directory.
  Push $0
  Push $1
  Push $2
  StrCpy $Failure ""
  StrCpy $PathInput "$INSTDIR"
  StrLen $0 $PathInput
  ${If} $0 == 0
    StrCpy $Failure "请选择安装文件夹。"
    Goto path_done_${PREFIX}
  ${EndIf}
  StrCpy $0 $PathInput 2
  ${If} $0 == "\\"
    StrCpy $Failure "请选择本机磁盘文件夹，不支持网络或设备路径。"
    Goto path_done_${PREFIX}
  ${EndIf}
  StrCpy $0 $PathInput 1 1
  StrCpy $1 $PathInput 1 2
  ${If} $0 != ":"
    StrCpy $Failure "安装路径必须是本机磁盘的绝对路径。"
    Goto path_done_${PREFIX}
  ${EndIf}
  ${If} $1 != "\"
  ${AndIf} $1 != "/"
    StrCpy $Failure "请选择完整路径，例如 C:\Users\用户名\AppData\Local\Programs\MintPortrait。"
    Goto path_done_${PREFIX}
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w "$PathInput", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r0'
  ${If} $0 == 0
  ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
    StrCpy $Failure "无法解析所选安装路径，或路径过长。请检查文件夹名称。"
    Goto path_done_${PREFIX}
  ${EndIf}
  StrCpy $PathCandidate "$1"
  ; Normalize trailing separators without turning C:\ into the drive-relative C:.
  path_trim_${PREFIX}:
    StrLen $0 $PathCandidate
    ${If} $0 <= 3
      StrCpy $Failure "请选择专用的程序文件夹，不要选择磁盘根目录。"
      Goto path_done_${PREFIX}
    ${EndIf}
    StrCpy $1 $PathCandidate 1 -1
    ${If} $1 == "\"
    ${OrIf} $1 == "/"
      StrCpy $PathCandidate $PathCandidate -1
      Goto path_trim_${PREFIX}
    ${EndIf}
  ${If} $PathCandidate == $PROFILE
  ${OrIf} $PathCandidate == $DESKTOP
  ${OrIf} $PathCandidate == $DOCUMENTS
  ${OrIf} $PathCandidate == $LOCALAPPDATA
  ${OrIf} $PathCandidate == $APPDATA
  ${OrIf} $PathCandidate == $WINDIR
  ${OrIf} $PathCandidate == $SYSDIR
  ${OrIf} $PathCandidate == $PROGRAMFILES64
    StrCpy $Failure "请选择独立的程序子文件夹，不要使用系统或个人资料目录本身。"
    Goto path_done_${PREFIX}
  ${EndIf}
  StrCpy $Probe "$PathCandidate"
  path_loop_${PREFIX}:
    System::Call 'kernel32::GetFileAttributesW(w "$Probe") i .r0'
    ${If} $0 != -1
      IntOp $1 $0 & 0x400
      ${If} $1 != 0
        StrCpy $Failure "路径包含链接或重定向文件夹。请选择普通本机目录。"
        Goto path_done_${PREFIX}
      ${EndIf}
    ${EndIf}
    ${GetParent} "$Probe" $1
    StrLen $0 $1
    ${If} $0 <= 3
      Goto path_valid_${PREFIX}
    ${EndIf}
    ${If} $1 == $Probe
      Goto path_valid_${PREFIX}
    ${EndIf}
    StrCpy $Probe "$1"
    Goto path_loop_${PREFIX}
  path_valid_${PREFIX}:
    StrCpy $INSTDIR "$PathCandidate"
  path_done_${PREFIX}:
    Pop $2
    Pop $1
    Pop $0
FunctionEnd
!macroend
!insertmacro SafePathFunction ""
!insertmacro SafePathFunction "un."

Function CheckEmptyDestination
  Call CheckSafePath
  ${If} $Failure != ""
    Return
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
  ${If} $0 != -1
    IntOp $1 $0 & 0x10
    ${If} $1 == 0
      StrCpy $Failure "所选路径是文件，不是文件夹。"
      Return
    ${EndIf}
  ${EndIf}
  ClearErrors
  FindFirst $Handle $Entry "$INSTDIR\*"
  ${If} ${Errors}
    Return
  ${EndIf}
  empty_loop:
    ${If} $Entry != "."
    ${AndIf} $Entry != ".."
    ${AndIf} $Entry != ""
      StrCpy $Failure "目标文件夹不是空的。请选择新建或空文件夹；不会覆盖其中的文件。"
      FindClose $Handle
      Return
    ${EndIf}
    ClearErrors
    FindNext $Handle $Entry
    ${IfNot} ${Errors}
      Goto empty_loop
    ${EndIf}
  FindClose $Handle
FunctionEnd

Function DirectoryLeave
  Call CheckEmptyDestination
  ${If} $Failure != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$Failure"
    Abort
  ${EndIf}
FunctionEnd

Function CheckAppStopped
  nsProcess::_FindProcess "MintPortrait.exe"
  Pop $0
  ${If} $0 != 603
    StrCpy $Failure "请先关闭所有薄荷人像窗口，再安装。若仍提示，请确认应用已完全退出。"
  ${EndIf}
FunctionEnd

Function CleanupStage
  ${If} $StageOwned == "1"
    ReadINIStr $0 "$Stage\.mint-stage.ini" "Stage" "Owner"
    System::Call 'kernel32::GetFileAttributesW(w "$Stage") i .r1'
    IntOp $1 $1 & 0x400
    ${If} $0 == "${PRODUCT_ID}"
    ${AndIf} $1 == 0
      SetOutPath "$TEMP"
      RMDir /r "$Stage"
    ${EndIf}
  ${EndIf}
  StrCpy $StageOwned "0"
FunctionEnd

Function .onInstFailed
  Call CleanupStage
FunctionEnd

Section "薄荷人像（必需）" MainSection
  SectionIn RO
  AddSize 650000
  Call CheckEmptyDestination
  ${If} $Failure != ""
    Goto install_fail
  ${EndIf}
  Call CheckAppStopped
  ${If} $Failure != ""
    Goto install_fail
  ${EndIf}
  InitPluginsDir
  !ifndef OFFLINE
    DetailPrint "从 Electron 官方 GitHub 下载固定版本运行组件…"
    download_retry:
    INetC::get /NOCOOKIES /CONNECTTIMEOUT 30 /RECEIVETIMEOUT 60 /CAPTION "下载官方运行组件" /CANCELTEXT "取消下载" /QUESTION "确认取消安装下载？" "${RUNTIME_URL}" "$PLUGINSDIR\runtime.zip" /END
    Pop $0
    ${If} $0 == "Cancelled"
      StrCpy $Failure "下载已取消，未安装程序。"
      Goto install_fail
    ${EndIf}
    ${If} $0 != "OK"
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "下载失败：$0$\r$\n请检查网络后重试。不会绕过代理或证书检查。" IDRETRY download_retry
      StrCpy $Failure "下载未完成，未安装程序。"
      Goto install_fail
    ${EndIf}
    DetailPrint "验证运行组件 SHA-256…"
    Push "SHA2-256"
    Push "$PLUGINSDIR\runtime.zip"
    StdUtils::HashFile
    Pop $0
    ${If} $0 != "${RUNTIME_SHA}"
      StrCpy $Failure "下载文件校验失败，已停止，未运行任何下载程序。"
      Goto install_fail
    ${EndIf}
  !endif
  ; Revalidate after waiting for the network, before any selected-directory mutation.
  Call CheckEmptyDestination
  ${If} $Failure != ""
    Goto install_fail
  ${EndIf}
  ${GetParent} "$INSTDIR" $Parent
  CreateDirectory "$Parent"
  ClearErrors
  GetTempFileName $Stage "$Parent"
  ${If} ${Errors}
    StrCpy $Failure "无法在所选磁盘创建临时文件。请选择有写入权限的路径。"
    Goto install_fail
  ${EndIf}
  Delete "$Stage"
  CreateDirectory "$Stage"
  WriteINIStr "$Stage\.mint-stage.ini" "Stage" "Owner" "${PRODUCT_ID}"
  ReadINIStr $0 "$Stage\.mint-stage.ini" "Stage" "Owner"
  ${If} $0 != "${PRODUCT_ID}"
    StrCpy $Failure "无法创建安装暂存目录。"
    Goto install_fail
  ${EndIf}
  StrCpy $StageOwned "1"
  !ifdef OFFLINE
    SetOutPath "$Stage"
    File /r "payload/*"
  !else
    DetailPrint "解压已验证的运行组件…"
    nsisunz::Unzip "$PLUGINSDIR\runtime.zip" "$Stage"
    Pop $0
    ${If} $0 != "success"
      StrCpy $Failure "运行组件解压失败：$0"
      Goto install_fail
    ${EndIf}
    Rename "$Stage\electron.exe" "$Stage\MintPortrait.exe"
    Delete "$Stage\resources\default_app.asar"
    SetOutPath "$Stage\resources"
    File "payload/resources/app.asar"
    SetOutPath "$Stage\resources\app.asar.unpacked"
    File /r "payload/resources/app.asar.unpacked/*"
    SetOutPath "$Stage"
    File "payload/MintPortrait.ico"
    File "payload/使用说明.txt"
    File "payload/INSTALLER-NOTICES.txt"
    File "payload/NSIS-LICENSES.txt"
  !endif
  DetailPrint "验证全部程序文件…"
  !insertmacro VerifyPayload "$Stage"
  ClearErrors
  WriteUninstaller "$Stage\Uninstall.exe"
  ${If} ${Errors}
    StrCpy $Failure "无法写入卸载程序，已停止安装。"
    Goto install_fail
  ${EndIf}
  IfFileExists "$Stage\Uninstall.exe" +3
    StrCpy $Failure "卸载程序缺失，已停止安装。"
    Goto install_fail
  ClearErrors
  WriteINIStr "$Stage\.mint-portrait-install.ini" "Install" "Product" "${PRODUCT_ID}"
  WriteINIStr "$Stage\.mint-portrait-install.ini" "Install" "Path" "$INSTDIR"
  WriteINIStr "$Stage\.mint-portrait-install.ini" "Install" "Version" "${VERSION}"
  ${If} ${Errors}
    StrCpy $Failure "无法写入安装识别信息，已停止安装。"
    Goto install_fail
  ${EndIf}
  ReadINIStr $0 "$Stage\.mint-portrait-install.ini" "Install" "Product"
  ReadINIStr $1 "$Stage\.mint-portrait-install.ini" "Install" "Path"
  ReadINIStr $2 "$Stage\.mint-portrait-install.ini" "Install" "Version"
  ${If} $0 != "${PRODUCT_ID}"
  ${OrIf} $1 != $INSTDIR
  ${OrIf} $2 != "${VERSION}"
    StrCpy $Failure "安装识别信息验证失败，已停止安装。"
    Goto install_fail
  ${EndIf}
  Delete "$Stage\.mint-stage.ini"
  ; All cancellation-prone download/extraction is finished. Commit is a same-volume rename.
  Call CheckEmptyDestination
  ${If} $Failure != ""
    WriteINIStr "$Stage\.mint-stage.ini" "Stage" "Owner" "${PRODUCT_ID}"
    Goto install_fail
  ${EndIf}
  Call CheckAppStopped
  ${If} $Failure != ""
    WriteINIStr "$Stage\.mint-stage.ini" "Stage" "Owner" "${PRODUCT_ID}"
    Goto install_fail
  ${EndIf}
  SetOutPath "$TEMP"
  RMDir "$INSTDIR" ; empty destination only; never recursive
  ClearErrors
  Rename "$Stage" "$INSTDIR"
  ${If} ${Errors}
    WriteINIStr "$Stage\.mint-stage.ini" "Stage" "Owner" "${PRODUCT_ID}"
    StrCpy $Failure "无法完成安装目录提交。目标可能被占用；未覆盖已有文件。"
    Goto install_fail
  ${EndIf}
  StrCpy $StageOwned "0"
  StrCpy $Committed "1"
  ClearErrors
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "Mint Portrait"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\MintPortrait.ico"
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" 420000
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ${If} ${Errors}
    StrCpy $Failure "程序文件已安装，但 Windows 卸载信息写入失败。可运行安装目录中的 Uninstall.exe 移除；未自动启动程序。"
    Goto install_fail
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\薄荷人像 Desktop"
  IfFileExists "$SMPROGRAMS\薄荷人像 Desktop\薄荷人像.lnk" start_skip
    ClearErrors
    CreateShortcut "$SMPROGRAMS\薄荷人像 Desktop\薄荷人像.lnk" "$INSTDIR\MintPortrait.exe" "" "$INSTDIR\MintPortrait.ico"
    ${IfNot} ${Errors}
      WriteINIStr "$INSTDIR\.mint-portrait-install.ini" "Install" "StartShortcut" "1"
    ${EndIf}
  start_skip:
  IfFileExists "$SMPROGRAMS\薄荷人像 Desktop\卸载.lnk" uninstall_shortcut_skip
    ClearErrors
    CreateShortcut "$SMPROGRAMS\薄荷人像 Desktop\卸载.lnk" "$INSTDIR\Uninstall.exe"
    ${IfNot} ${Errors}
      WriteINIStr "$INSTDIR\.mint-portrait-install.ini" "Install" "UninstallShortcut" "1"
    ${EndIf}
  uninstall_shortcut_skip:
  DetailPrint "程序安装完成。"
  Goto install_done
  install_fail:
    Call CleanupStage
    SetErrorLevel 2
    MessageBox MB_OK|MB_ICONEXCLAMATION "$Failure"
    Abort "$Failure"
  install_done:
SectionEnd

Section "创建桌面快捷方式" DesktopSection
  IfFileExists "$DESKTOP\薄荷人像 Desktop.lnk" desktop_skip
  ClearErrors
  CreateShortcut "$DESKTOP\薄荷人像 Desktop.lnk" "$INSTDIR\MintPortrait.exe" "" "$INSTDIR\MintPortrait.ico"
  ${IfNot} ${Errors}
    WriteINIStr "$INSTDIR\.mint-portrait-install.ini" "Install" "DesktopShortcut" "1"
  ${EndIf}
  desktop_skip:
SectionEnd

Function un.CheckOwnedInstallation
  Call un.CheckSafePath
  ${If} $Failure != ""
    MessageBox MB_OK|MB_ICONSTOP "$Failure"
    Abort
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\.mint-portrait-install.ini" "Install" "Product"
  ReadINIStr $1 "$INSTDIR\.mint-portrait-install.ini" "Install" "Path"
  ${If} $0 != "${PRODUCT_ID}"
  ${OrIf} $1 != $INSTDIR
    MessageBox MB_OK|MB_ICONSTOP "不能确认此目录属于薄荷人像，已停止卸载。"
    Abort
  ${EndIf}
  nsProcess::_FindProcess "MintPortrait.exe"
  Pop $0
  ${If} $0 != 603
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先关闭薄荷人像，再重新卸载。不会强制结束进程。"
    Abort
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  Call un.CheckOwnedInstallation
FunctionEnd

Section "Uninstall"
  Call un.CheckOwnedInstallation
  !insertmacro ValidateOwnedPayloadDirectories "$INSTDIR"
  ; Preserve the earlier top-level checks as additional defense.
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\resources") i .r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
  ${Else}
    StrCpy $0 0
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "程序资源目录已被替换为链接。为保护其他文件，已停止卸载。"
    Abort
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\locales") i .r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
  ${Else}
    StrCpy $0 0
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "语言目录已被替换为链接。为保护其他文件，已停止卸载。"
    Abort
  ${EndIf}
  SetOutPath "$TEMP"
  StrCpy $DeleteFailed "0"
  !insertmacro RemoveOwnedPayload "$INSTDIR"
  ${If} $DeleteFailed == "1"
    MessageBox MB_OK|MB_ICONEXCLAMATION "部分程序文件仍被占用，卸载记录已保留。请关闭相关程序后重新卸载。其他文件未删除。"
    SetErrorLevel 2
    Abort
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\.mint-portrait-install.ini" "Install" "DesktopShortcut"
  ${If} $0 == "1"
    Delete "$DESKTOP\薄荷人像 Desktop.lnk"
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\.mint-portrait-install.ini" "Install" "StartShortcut"
  ${If} $0 == "1"
    Delete "$SMPROGRAMS\薄荷人像 Desktop\薄荷人像.lnk"
  ${EndIf}
  ReadINIStr $0 "$INSTDIR\.mint-portrait-install.ini" "Install" "UninstallShortcut"
  ${If} $0 == "1"
    Delete "$SMPROGRAMS\薄荷人像 Desktop\卸载.lnk"
  ${EndIf}
  RMDir "$SMPROGRAMS\薄荷人像 Desktop"
  ; Back up the uninstaller before final metadata cleanup so a locked marker is recoverable.
  InitPluginsDir
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\Uninstall.exe" "$PLUGINSDIR\uninstall-backup.exe"
  CopyFiles /SILENT "$INSTDIR\.mint-portrait-install.ini" "$PLUGINSDIR\install-marker-backup.ini"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法备份卸载程序，记录已保留。请关闭相关程序后重试。"
    SetErrorLevel 2
    Abort
  ${EndIf}
  ClearErrors
  Delete "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "卸载程序仍被占用，记录已保留。请关闭相关程序后重试。"
    SetErrorLevel 2
    Abort
  ${EndIf}
  ClearErrors
  Delete "$INSTDIR\.mint-portrait-install.ini"
  ${If} ${Errors}
    ClearErrors
    CopyFiles /SILENT "$PLUGINSDIR\uninstall-backup.exe" "$INSTDIR\Uninstall.exe"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "卸载记录无法清理且卸载程序恢复失败。程序文件已移除，Windows记录保留；请反馈此错误以协助修复。"
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "卸载识别文件仍被占用，卸载程序与记录已保留。请关闭相关程序后重试。"
    ${EndIf}
    SetErrorLevel 2
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "${REGKEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    ClearErrors
    DeleteRegKey HKCU "${REGKEY}"
    ${If} ${Errors}
      ClearErrors
      CopyFiles /SILENT "$PLUGINSDIR\uninstall-backup.exe" "$INSTDIR\Uninstall.exe"
      CopyFiles /SILENT "$PLUGINSDIR\install-marker-backup.ini" "$INSTDIR\.mint-portrait-install.ini"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "Windows卸载记录无法移除且恢复失败。请反馈此错误以协助修复；未删除任何照片。"
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Windows卸载记录无法移除，卸载程序和识别信息已恢复。请稍后重试。"
      ${EndIf}
      SetErrorLevel 2
      Abort
    ${EndIf}
  ${EndIf}
  RMDir "$INSTDIR"
  DetailPrint "已卸载程序。其他文件、照片和用户偏好保持不变。"
SectionEnd
