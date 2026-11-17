#!/usr/bin/env python3
"""
Dummy publisher untuk Camera Tile dashboard.
Broadcast JSON (gambar base64 + bounding box + jumlah kendaraan) via WebSocket.

Contoh:
  python3 json_publisher.py --source N=/home/mamat/record_trial/traffic
  python3 json_publisher.py --source N=/data/a E=/data/b S=/data/c --yolo /home/mamat/camtrack_ws/yolo11n.pt
  python3 json_publisher.py            # frame sintetis + box acak

Dependensi: pip install websockets opencv-python numpy ultralytics
"""
import argparse
import asyncio
import base64
import json
import os
import random
import re

import cv2
import numpy as np
import websockets

VEHICLE_CLASSES = {2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck'}
clients = set()


def natural_key(name):
    return [int(s) if s.isdigit() else s for s in re.split(r'(\d+)', name)]


def list_images(folder):
    files = [f for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    return [os.path.join(folder, f) for f in sorted(files, key=natural_key)]


def encode_jpeg(frame, quality):
    ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf.tobytes()).decode('ascii')


def resize_to_width(frame, max_w):
    h, w = frame.shape[:2]
    if w <= max_w:
        return frame
    return cv2.resize(frame, (max_w, int(h * max_w / w)))


def synthetic_frame(w=640, h=360):
    frame = np.full((h, w, 3), 40, np.uint8)
    cv2.rectangle(frame, (0, int(h * 0.35)), (w, int(h * 0.75)), (60, 60, 60), -1)
    noise = np.random.randint(0, 12, frame.shape, dtype=np.uint8)
    return cv2.add(frame, noise)


def fake_boxes(w, h):
    boxes = []
    for _ in range(random.randint(0, 5)):
        bw, bh = random.randint(50, 110), random.randint(35, 70)
        x1, y1 = random.randint(0, w - bw), random.randint(int(h * 0.3), h - bh)
        boxes.append({
            'x1': x1, 'y1': y1, 'x2': x1 + bw, 'y2': y1 + bh,
            'label': random.choice(list(VEHICLE_CLASSES.values())),
            'conf': round(random.uniform(0.5, 0.98), 2),
        })
    return boxes


def yolo_boxes(model, frame):
    res = model(frame, verbose=False)[0]
    boxes = []
    for b in res.boxes:
        cid = int(b.cls[0].item())
        if cid not in VEHICLE_CLASSES:
            continue
        x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
        boxes.append({
            'x1': round(x1, 1), 'y1': round(y1, 1), 'x2': round(x2, 1), 'y2': round(y2, 1),
            'label': VEHICLE_CLASSES[cid], 'conf': round(float(b.conf[0].item()), 2),
        })
    return boxes


async def handler(ws):
    clients.add(ws)
    print(f'[ws] client connected ({len(clients)} total)')
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)
        print(f'[ws] client disconnected ({len(clients)} total)')


async def stream(direction, folder, args, model):
    files = list_images(folder) if folder else []
    if folder and not files:
        print(f'[{direction}] tidak ada gambar di {folder}')
        return
    idx = 0
    while True:
        if files:
            frame = cv2.imread(files[idx])
            idx += 1
            if idx >= len(files):
                if not args.loop:
                    print(f'[{direction}] selesai')
                    return
                idx = 0
            if frame is None:
                continue
        else:
            frame = synthetic_frame()

        frame = resize_to_width(frame, args.max_width)  # koordinat box mengikuti frame ini
        h, w = frame.shape[:2]
        if model is not None:
            boxes = await asyncio.to_thread(yolo_boxes, model, frame)
        else:
            boxes = fake_boxes(w, h)

        payload = {
            'dir': direction,
            'image': encode_jpeg(frame, args.quality),
            'width': w,
            'height': h,
            'boxes': boxes,
            'count': len(boxes),
        }
        if clients:
            websockets.broadcast(clients, json.dumps(payload))
        await asyncio.sleep(1.0 / args.fps)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', nargs='*', default=[],
                    help='DIR=folder, mis. N=/path/a E=/path/b. Folder tanpa DIR dianggap N')
    ap.add_argument('--dirs', nargs='*', default=['N', 'E', 'S', 'W'],
                    help='Arah yang dikirim jika tanpa --source (frame sintetis)')
    ap.add_argument('--yolo', default=None, help='Path model YOLO; kosongkan untuk box dummy acak')
    ap.add_argument('--fps', type=float, default=5.0)
    ap.add_argument('--max-width', type=int, default=640)
    ap.add_argument('--quality', type=int, default=70)
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--no-loop', dest='loop', action='store_false')
    args = ap.parse_args()

    sources = {}
    for s in args.source:
        d, _, path = s.partition('=')
        if not path:
            d, path = 'N', s
        sources[d.upper()] = path
    if not sources:
        sources = {d: None for d in args.dirs}

    model = None
    if args.yolo:
        from ultralytics import YOLO
        model = YOLO(args.yolo)

    print(f'[ws] ws://{args.host}:{args.port} | arah: {", ".join(sources)} | '
          f'{"YOLO" if model else "dummy boxes"} | {args.fps} fps')
    async with websockets.serve(handler, args.host, args.port):
        await asyncio.gather(*(stream(d, p, args, model) for d, p in sources.items()))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass