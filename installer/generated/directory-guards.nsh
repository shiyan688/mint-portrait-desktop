!macro ValidateOwnedPayloadDirectories ROOT
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\locales") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources\app.asar.unpacked") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources\app.asar.unpacked\node_modules") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources\app.asar.unpacked\node_modules\@img") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib") i .r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      MessageBox MB_OK|MB_ICONSTOP "无法验证程序目录属性。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${Else}
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "程序子目录已被替换为链接。为保护其他文件，已停止卸载。"
      Abort
    ${EndIf}
  ${EndIf}
!macroend
