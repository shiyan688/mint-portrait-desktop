!macro VerifyPayload ROOT
  Push "SHA2-256"
  Push "${ROOT}\INSTALLER-NOTICES.txt"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "0781a9e466a1a7ee0c6b55b119931a39e8de76f34e199c64971f498d1c99501d" +3
    StrCpy $Failure "文件校验失败：INSTALLER-NOTICES.txt"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\LICENSE"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d" +3
    StrCpy $Failure "文件校验失败：LICENSE"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\LICENSES.chromium.html"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "7dac8267ac6da8d959cfe88f5f055b18a397f10230380b5329125e167bf5639b" +3
    StrCpy $Failure "文件校验失败：LICENSES.chromium.html"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\MintPortrait.exe"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "8e84549b05d27d444da2957653200d1e0ac287eff0fc5722b92835b9e0821a59" +3
    StrCpy $Failure "文件校验失败：MintPortrait.exe"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\MintPortrait.ico"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "a42f31d443eeece3f0e73b90e61661d2071961cc08aa9cf19d3c49bcc5c8df74" +3
    StrCpy $Failure "文件校验失败：MintPortrait.ico"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\NSIS-LICENSES.txt"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "d2b03d11801736ff4fda2a1e215a13c324dca7fd76eb948ae7d835000fe339d3" +3
    StrCpy $Failure "文件校验失败：NSIS-LICENSES.txt"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\chrome_100_percent.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "8e865e7cd40faabcbfb4cd2be16ee290023c3a28796c4f95451440d80174225d" +3
    StrCpy $Failure "文件校验失败：chrome_100_percent.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\chrome_200_percent.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "352baed89a9051dc959dfa8e73024212ef98e173e37d0fc064887013748fcdca" +3
    StrCpy $Failure "文件校验失败：chrome_200_percent.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\d3dcompiler_47.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "f5c95e919b4ffa1ac71049cd45b9f986d2965e6888395ca2806337985334fa56" +3
    StrCpy $Failure "文件校验失败：d3dcompiler_47.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\dxcompiler.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "6af17f483f97ca18b579da8475855469dde1b69b7e7872cae13bcbacc2d33200" +3
    StrCpy $Failure "文件校验失败：dxcompiler.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\electron_wer.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "234b9aba3c2c5bb545dedb26783692ec90313a3e17a532ae7c514f8058adf117" +3
    StrCpy $Failure "文件校验失败：electron_wer.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\ffmpeg.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "cdf2b70f0f0a97c9840af1466dd86a90e564c98f6892d783635cf9c3b303d613" +3
    StrCpy $Failure "文件校验失败：ffmpeg.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\icudtl.dat"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "02a01b3188b6a41a756f7322fdb5e6b5ca6573b327b01dfc8ed662d571a6f769" +3
    StrCpy $Failure "文件校验失败：icudtl.dat"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\af.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "10121e47f8fe41355dd8f4475907be7adea7f5b25459aa53c9f3ef07dafef05c" +3
    StrCpy $Failure "文件校验失败：locales\af.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\am.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "5150bc6cfc63844816e305b9645cb8e15587ff826a2be1d8639f2087bfb0a5da" +3
    StrCpy $Failure "文件校验失败：locales\am.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ar.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "2e92d1b3098b03c88b5265a1ecdd1e303a936540c8fa9107a846b02df751aed8" +3
    StrCpy $Failure "文件校验失败：locales\ar.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\bg.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "3f9d18988748118895dc026e4f56a442f078d3a5d564000d177a52ce934346b7" +3
    StrCpy $Failure "文件校验失败：locales\bg.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\bn.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e2d4d1c81b0218849880b01c896d1d92c2a28347860cb4d5f37d4c777e4aa7cb" +3
    StrCpy $Failure "文件校验失败：locales\bn.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ca.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "17c4e990fd021755b01cb96b0bce8c7c443d41397b56ad084f81761ca580e7ac" +3
    StrCpy $Failure "文件校验失败：locales\ca.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\cs.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "cdd8eb041d9e2231e737c5cacae51034d3e3935e2c33d31d216caa17e5d941ff" +3
    StrCpy $Failure "文件校验失败：locales\cs.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\da.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "cdf0ea6c9f400af2374c88e50e0cd0a33d9a1ee58db797ad15f7b1ad99890a96" +3
    StrCpy $Failure "文件校验失败：locales\da.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\de.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e2616265df1c57101339cde08a704a5f212a5c7446b187227a26326dc939a2be" +3
    StrCpy $Failure "文件校验失败：locales\de.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\el.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "f8e4cc68aed45935d7311bd98627fce5934ffcc151d109093de689696c890ec0" +3
    StrCpy $Failure "文件校验失败：locales\el.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\en-GB.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e2cf3bd4d2ec7f900c710346362b03bdedf0a46285fd32d9cf6b8fab373b2f20" +3
    StrCpy $Failure "文件校验失败：locales\en-GB.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\en-US.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "de43db43fe0072543ab225f6d762cce3656a1639bf9e25f371fe0e80d9eabba7" +3
    StrCpy $Failure "文件校验失败：locales\en-US.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\es-419.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "9abcee391a295fa79e389b16c6843e42884bfa548fbdd62a85a18a321e4b317f" +3
    StrCpy $Failure "文件校验失败：locales\es-419.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\es.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "a15d9687d249228faf9953f2da7dd946ab6caaec0e477a692a57ec2150fdfc86" +3
    StrCpy $Failure "文件校验失败：locales\es.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\et.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "9a8f5574c2a9931e6bd2eb2c021e2132d39a6f569e8fdc40a8475e5a8c0a776a" +3
    StrCpy $Failure "文件校验失败：locales\et.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\fa.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "eda1e584f110cacb61fbe38ddecdb8247ed8a1e4cb7e5f5cfa39e4d8e84387f5" +3
    StrCpy $Failure "文件校验失败：locales\fa.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\fi.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "a3e8bcb525568ba1e1908e8cc57b9e05b3ee3d9245cd74894d0fb485eb79a9a7" +3
    StrCpy $Failure "文件校验失败：locales\fi.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\fil.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "808d6f4620a9c4fee771dfcf39f382db42e83f1e66fe206f93797b86c22dea24" +3
    StrCpy $Failure "文件校验失败：locales\fil.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\fr.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "fd3963fe1811d3107d0ce8fe217211d67b201ecc24d0bf9e95d30071e16d6923" +3
    StrCpy $Failure "文件校验失败：locales\fr.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\gu.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "71d29958f321c014b0d36625c9e7d5af7e42e5ab2d753ecd6bceaf02b64d652d" +3
    StrCpy $Failure "文件校验失败：locales\gu.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\he.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "7edfc0e9033ad6e451e175e14d2fba4a158129cbbf45c768314d86c6e1f1b207" +3
    StrCpy $Failure "文件校验失败：locales\he.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\hi.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e55d2c94104b5e4329c5f254cf670caa6414ca1137af260e86adeff986f4292f" +3
    StrCpy $Failure "文件校验失败：locales\hi.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\hr.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "96506f22e560e838ae740bfd72e07ad7a484d4af2d52816a64b9b35742dbf5b3" +3
    StrCpy $Failure "文件校验失败：locales\hr.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\hu.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "0d44b7669e37805786b3fe637f2291654c2698b8ec8b57ddec17c1cf4bea5857" +3
    StrCpy $Failure "文件校验失败：locales\hu.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\id.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "7111a5623ece2362e16be5a785030a9a628937ab680db34c9dbab6ae7926d0e6" +3
    StrCpy $Failure "文件校验失败：locales\id.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\it.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "b78bca99c590f45b660ce446a0a094e3d7a101c987965ac4e697f79685c230c9" +3
    StrCpy $Failure "文件校验失败：locales\it.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ja.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "239445223165dd02d8f1a048a7740e5b8cd845491965f17b92ccf57eea29ba66" +3
    StrCpy $Failure "文件校验失败：locales\ja.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\kn.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "cc9903cb7a98ac81c08b33d3f88e88f35b290eaf0f5eaa8fab67395b330d88f0" +3
    StrCpy $Failure "文件校验失败：locales\kn.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ko.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "d3d22df64bab98e36e5a5635e98b33323af0a4b7f1a649bc049e1a753cd70ccb" +3
    StrCpy $Failure "文件校验失败：locales\ko.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\lt.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "2fe1400fc3e0010f30955171124c9c8bf0fbab6aaddfce967b997bdc31fa2977" +3
    StrCpy $Failure "文件校验失败：locales\lt.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\lv.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "3ed091a6dbba7b8a5a4beff7191918f84ee0a7de23004d76f57826104094f02b" +3
    StrCpy $Failure "文件校验失败：locales\lv.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ml.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "6e3480887885349cd3198c2f608da25bc7722dbad7c1fba695f95e0e6d564b36" +3
    StrCpy $Failure "文件校验失败：locales\ml.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\mr.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "7bb875ecd2f725eb037758e261dea1d53c2c6668ccbc6b10fedbb427d0947b8d" +3
    StrCpy $Failure "文件校验失败：locales\mr.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ms.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e0a46e0f40cf0c197c2a1fcb2adca421a93d2ade3d1333b99489f8b7d4a335d3" +3
    StrCpy $Failure "文件校验失败：locales\ms.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\nb.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "754820b5f3ec2a19f5a0177026541654bba2a9394a665cd3006e049edd71881d" +3
    StrCpy $Failure "文件校验失败：locales\nb.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\nl.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "a319007b406469b5625f9e69ae4d29d9433540cd2c648e5b3b780249088e84a1" +3
    StrCpy $Failure "文件校验失败：locales\nl.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\pl.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "364ac77a3f7f3aed3f42016b12a4c140dc7e89b0ff197cddfa968269a414cb62" +3
    StrCpy $Failure "文件校验失败：locales\pl.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\pt-BR.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "03dc65858e45cebd064587e612d2fdcc1d4d2ead6a28aced2f6734e5c6862cb8" +3
    StrCpy $Failure "文件校验失败：locales\pt-BR.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\pt-PT.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "c850250976d474f43cd425d8a371c0a3c075490b21221a3e51797ab2cf9d950d" +3
    StrCpy $Failure "文件校验失败：locales\pt-PT.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ro.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "c8bac592c3f94d10da90e072ef6940108916d18c3fd6782a182635707435393b" +3
    StrCpy $Failure "文件校验失败：locales\ro.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ru.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "88d2779bbe1c8b8427ca9d78d23c53663e506910435dbdf88a949dc4ca91964b" +3
    StrCpy $Failure "文件校验失败：locales\ru.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\sk.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "15e26d007f346410e90ef313c4d09b1c02b11808eeb018559c7ae7b3ef77812d" +3
    StrCpy $Failure "文件校验失败：locales\sk.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\sl.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "4e9d2aa291c653c0b3a92c973e1d5d1ecd1b6c1cc64b569c0ae37a28b6d46bcd" +3
    StrCpy $Failure "文件校验失败：locales\sl.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\sr.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "fee1debf9c49f2beea7990258cb55483eb30841642c2e7c0ea540472682cf2f0" +3
    StrCpy $Failure "文件校验失败：locales\sr.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\sv.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "5cd184cc67d1fa6d4f8c82f0809d803bb8f4c61d07d676e54808e6ced09e9b68" +3
    StrCpy $Failure "文件校验失败：locales\sv.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\sw.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "813bd56c6c8e0b13b61f15efe8bc7d14d0e670c0dce93efdda3cc428cf989e63" +3
    StrCpy $Failure "文件校验失败：locales\sw.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ta.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "6ef6497441c04f7dcc18caa552d961c5f22e8b369c97a6632bca6b57d6bd7876" +3
    StrCpy $Failure "文件校验失败：locales\ta.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\te.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "301a6b26e82540bc6079c1e210f575950b1dbd8c03437a7817d8446c06c755e7" +3
    StrCpy $Failure "文件校验失败：locales\te.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\th.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "acf2778d5abda266d91a534d8ceb14cfe2fe34bc41a157c4b7a2058ba778ccbb" +3
    StrCpy $Failure "文件校验失败：locales\th.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\tr.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e3b2168d566124c306d8ecff00b1ba0e54c282958ec8d5bcf9d94cbe638008f6" +3
    StrCpy $Failure "文件校验失败：locales\tr.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\uk.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e9d26214e799ec895304952223dd3a5d13d3041e3984378c710fef5626d4d880" +3
    StrCpy $Failure "文件校验失败：locales\uk.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\ur.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "f4d5f15daf9f3dd422f52421b93f0b5f6791a9928facb0e1b6dfd894a3814281" +3
    StrCpy $Failure "文件校验失败：locales\ur.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\vi.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "9836065474cd9f4e0f351f472361fda7de790a6e27f5e67f8dc564465b8df029" +3
    StrCpy $Failure "文件校验失败：locales\vi.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\zh-CN.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "37abf1eacd32c638866147e9517b2a555d8a7dd2c0c79c05d09f877d9373b09a" +3
    StrCpy $Failure "文件校验失败：locales\zh-CN.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\locales\zh-TW.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "56b39b119f9dc0e38e8c67a556a02cbe877d9e00833c8922f05d8faee80bcb13" +3
    StrCpy $Failure "文件校验失败：locales\zh-TW.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "29df72c3ded9ffc7858b70cf4342c21b17c9561ba1c124b53dc88779cac186cf" +3
    StrCpy $Failure "文件校验失败：resources\app.asar"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\LICENSE.md"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e2eaa4603c14cb26f301e88648c12a853fa3f0f5da6d4b0972958c666e7f2ab8" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\colour\LICENSE.md"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\README.md"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "be7edf3bc6467f761168cef3bb2b9b3def2532c98a86249848376ea00338ad1d" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\colour\README.md"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\color.cjs"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "f7c3efcf482624007f2019fffee3e1dec56b8cb893faa9a420b2832805888dce" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\colour\color.cjs"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\index.cjs"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e6e93e7fb209420a20fdf2ec676e9c67413be8d5ace99eec64f9468480f0368d" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\colour\index.cjs"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\index.d.ts"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "2467b00d963828f540f4acd7910f4c04cfe4b489550e6bb682212f65583bca5b" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\colour\index.d.ts"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\colour\package.json"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "bc38c5097693ed53b91c32f35fb0a52569736c7854ba2eb6d080f3252071f75c" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\colour\package.json"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\LICENSE"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\LICENSE"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\README.md"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "3d083ada5ebafe1e6c227daa7b061d4254b61df4a3901c359ffdeac817ce5866" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\README.md"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\index.cjs"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "6ecbd583f45e914233410fe83a614e4f5ff1a6875a7eb828b03b7258e8ba6944" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\index.cjs"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "06dab07cc386748513337a31672b1d5269fbc770a14ff403080575665bf0813f" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-cpp-8.18.7.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "25001dbd05305a0a29119ab49933622c70b4a20ea12ef1d5d20ca40181db53bf" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-cpp-8.18.7.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64-0.35.5.node"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "971048779f9c8598df14641dfc03c625885c93f473a788e65ca2deb50d0b083e" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64-0.35.5.node"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\package.json"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "697b3d89590e3b988b51764bd22dfd6f4a1b35cd4eb12c664eca7987e8ee6115" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\package.json"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\versions.json"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "e2611d5d854815a8b33c8a3d2ec649511a9596ccf16844e8eae7cf81e79881c4" +3
    StrCpy $Failure "文件校验失败：resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\versions.json"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\resources.pak"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "a7b40d37892f0bb380b6735bdd9382ee69e9ca24dad1119bde5b53d55edb9b2b" +3
    StrCpy $Failure "文件校验失败：resources.pak"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\snapshot_blob.bin"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "008725a9d014f3942dd22b0b7ddbf01347576a1f92217b4de03bcac178a83427" +3
    StrCpy $Failure "文件校验失败：snapshot_blob.bin"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\v8_context_snapshot.bin"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "2fc28f6396a571fb6490504aff0b0f767bce24105cad2489dcc3d53396df8a38" +3
    StrCpy $Failure "文件校验失败：v8_context_snapshot.bin"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\version"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "281bb838d2512560c34bab2ceb5106a62f0fb0fe05f076896952a6153d007d94" +3
    StrCpy $Failure "文件校验失败：version"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\vk_swiftshader.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "00d703c0557b54edf35c284b15cb0063de1653edef71d33c698a64d2e74073c9" +3
    StrCpy $Failure "文件校验失败：vk_swiftshader.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\vk_swiftshader_icd.json"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "32d83ff113fef532a9f97e0d2831f8656628ab1c99e9060f0332b1532839afd9" +3
    StrCpy $Failure "文件校验失败：vk_swiftshader_icd.json"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\vulkan-1.dll"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "0802c28ebf8226fccaef45fc44b528873eb4814f714a817b01cc2f6ab49c24da" +3
    StrCpy $Failure "文件校验失败：vulkan-1.dll"
    Goto install_fail
  Push "SHA2-256"
  Push "${ROOT}\使用说明.txt"
  StdUtils::HashFile
  Pop $0
  StrCmp $0 "01afbf539d8a26a9b22a753a08f978c7771a2024c45c5d949d0d51174ffeb0ca" +3
    StrCpy $Failure "文件校验失败：使用说明.txt"
    Goto install_fail
!macroend
