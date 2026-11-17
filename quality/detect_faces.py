"""Actual offline MediaPipe Tasks inference. Never synthesizes or repairs landmarks."""
import json, hashlib, sys
from pathlib import Path
import mediapipe as mp
from mediapipe.tasks.python import vision
ROOT=Path(__file__).resolve().parent
model_path=ROOT.parent/'assets/models/face_landmarker.task'
opts=vision.FaceLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path),delegate=mp.tasks.BaseOptions.Delegate.CPU),num_faces=8,min_face_detection_confidence=.5,min_face_presence_confidence=.5)
paths=list((ROOT/'fixtures').glob('*.png')) if len(sys.argv)==1 else [Path(x) for x in sys.argv[1:]]
with vision.FaceLandmarker.create_from_options(opts) as detector:
 for path in paths:
  result=detector.detect(mp.Image.create_from_file(str(path)))
  faces=[[{'x':p.x,'y':p.y,'z':p.z} for p in face] for face in result.face_landmarks]
  out={'detector':'MediaPipe Tasks FaceLandmarker','version':mp.__version__,'delegate':'CPU','model_sha256':hashlib.sha256(model_path.read_bytes()).hexdigest(),'image_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'faces':faces}
  path.with_suffix('.landmarks.json').write_text(json.dumps(out))
  print(path.name,[len(f) for f in faces],flush=True)
  if not faces: raise RuntimeError('No real face detected in '+str(path))
