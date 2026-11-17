!macro RemoveOwnedPayload ROOT
  ClearErrors
  Delete "${ROOT}\INSTALLER-NOTICES.txt"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\LICENSE"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\LICENSES.chromium.html"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\MintPortrait.exe"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\MintPortrait.ico"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\NSIS-LICENSES.txt"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\chrome_100_percent.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\chrome_200_percent.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\d3dcompiler_47.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\dxcompiler.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\electron_wer.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\ffmpeg.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\icudtl.dat"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\af.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\am.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ar.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\bg.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\bn.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ca.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\cs.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\da.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\de.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\el.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\en-GB.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\en-US.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\es-419.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\es.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\et.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\fa.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\fi.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\fil.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\fr.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\gu.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\he.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\hi.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\hr.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\hu.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\id.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\it.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ja.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\kn.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ko.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\lt.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\lv.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ml.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\mr.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ms.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\nb.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\nl.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\pl.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\pt-BR.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\pt-PT.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ro.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ru.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\sk.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\sl.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\sr.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\sv.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\sw.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ta.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\te.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\th.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\tr.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\uk.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\ur.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\vi.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\zh-CN.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\locales\zh-TW.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\LICENSE.md"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\README.md"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\color.cjs"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\index.cjs"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\index.d.ts"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\package.json"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\LICENSE"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\README.md"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\index.cjs"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-cpp-8.18.7.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64-0.35.5.node"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\package.json"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\versions.json"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\resources.pak"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\snapshot_blob.bin"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\v8_context_snapshot.bin"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\version"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\vk_swiftshader.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\vk_swiftshader_icd.json"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\vulkan-1.dll"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  ClearErrors
  Delete "${ROOT}\使用说明.txt"
  ${If} ${Errors}
    StrCpy $DeleteFailed "1"
  ${EndIf}
  RMDir "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib"
  RMDir "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64"
  RMDir "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour"
  RMDir "${ROOT}\resources\app.asar.unpacked\node_modules\@img"
  RMDir "${ROOT}\resources\app.asar.unpacked\node_modules"
  RMDir "${ROOT}\resources\app.asar.unpacked"
  RMDir "${ROOT}\resources"
  RMDir "${ROOT}\locales"
!macroend
