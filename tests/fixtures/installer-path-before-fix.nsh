; Historical failing validator. Used only as a negative regression control.
!macro SafePathFunction PREFIX
Function ${PREFIX}CheckSafePath
  StrCpy $Failure ""
  GetFullPathName $INSTDIR "$INSTDIR"
  StrLen $0 $INSTDIR
  ${If} $0 < 6
    StrCpy $Failure "请选择专用的程序文件夹，不要选择磁盘根目录。"
    Return
  ${EndIf}
  StrCpy $0 $INSTDIR 2
  ${If} $0 == "\\"
    StrCpy $Failure "请选择本机磁盘文件夹，不支持网络或设备路径。"
    Return
  ${EndIf}
  StrCpy $0 $INSTDIR 1 1
  ${If} $0 != ":"
    StrCpy $Failure "安装路径必须是本机磁盘的绝对路径。"
    Return
  ${EndIf}
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == $0
    StrCpy $Failure "不能使用磁盘根目录。"
    Return
  ${EndIf}
  ${If} $INSTDIR == $PROFILE
  ${OrIf} $INSTDIR == $DESKTOP
  ${OrIf} $INSTDIR == $DOCUMENTS
  ${OrIf} $INSTDIR == $LOCALAPPDATA
  ${OrIf} $INSTDIR == $APPDATA
  ${OrIf} $INSTDIR == $WINDIR
  ${OrIf} $INSTDIR == $SYSDIR
  ${OrIf} $INSTDIR == $PROGRAMFILES64
    StrCpy $Failure "请选择独立的程序子文件夹，不要使用系统或个人资料目录本身。"
    Return
  ${EndIf}
  StrCpy $Probe "$INSTDIR"
  path_loop_${PREFIX}:
    System::Call 'kernel32::GetFileAttributesW(w "$Probe") i .r0'
    ${If} $0 != -1
      IntOp $1 $0 & 0x400
      ${If} $1 != 0
        StrCpy $Failure "路径包含链接或重定向文件夹。请选择普通本机目录。"
        Return
      ${EndIf}
    ${EndIf}
    ${GetParent} "$Probe" $1
    ${If} $1 == ""
      Return
    ${EndIf}
    ${If} $1 == $Probe
      Return
    ${EndIf}
    StrCpy $Probe "$1"
    Goto path_loop_${PREFIX}
FunctionEnd
!macroend
