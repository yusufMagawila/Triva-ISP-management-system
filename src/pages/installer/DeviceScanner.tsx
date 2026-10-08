/**
 * Device scanner — camera-based barcode/QR via the built-in BarcodeDetector
 * API where available, with manual-entry fallback always present.
 * Emits the raw payload; the backend normalizes and identifies.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Keyboard, X } from 'lucide-react';

interface Props {
  onScan: (payload: string) => void;
  onClose: () => void;
}

// BarcodeDetector isn't in the default TS DOM lib yet.
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

export default function DeviceScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);
  const stopped = useRef(false);

  const supported = typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined';

  useEffect(() => {
    if (!supported || showManual) return;
    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = (window as unknown as { BarcodeDetector: new () => BarcodeDetectorLike }).BarcodeDetector;
        const detector = new Detector();
        interval = setInterval(async () => {
          if (stopped.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length && codes[0].rawValue) {
              stopped.current = true;
              onScan(codes[0].rawValue);
            }
          } catch { /* frame not ready */ }
        }, 400);
      } catch {
        setCameraError('Camera unavailable — use manual entry below.');
        setShowManual(true);
      }
    })();

    return () => {
      stopped.current = true;
      if (interval) clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, showManual]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold">Scan Device</h2>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5" /></button>
        </div>

        {!showManual ? (
          <div className="relative bg-black aspect-[4/3]">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            <p className="absolute bottom-3 inset-x-0 text-center text-white/80 text-sm">
              Point camera at barcode or QR code
            </p>
            {cameraError && <p className="absolute top-3 inset-x-4 text-center text-amber-300 text-sm">{cameraError}</p>}
          </div>
        ) : (
          <div className="p-4">
            <label className="text-sm text-slate-600">Enter Serial / MAC / barcode manually</label>
            <input
              autoFocus
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="e.g. F43E0FEFA14C or DC:2C:6E:C9:D9:B0"
              className="mt-1 w-full border rounded-lg px-3 py-3 text-base"
            />
            <button
              disabled={!manual.trim()}
              onClick={() => onScan(manual.trim())}
              className="mt-3 w-full bg-cyan-600 disabled:bg-slate-300 text-white rounded-lg py-3 font-medium"
            >
              Identify Device
            </button>
          </div>
        )}

        <div className="p-4 border-t">
          <button
            onClick={() => setShowManual((s) => !s)}
            className="w-full flex items-center justify-center gap-2 text-sm text-slate-600 py-2"
          >
            {showManual ? <><Camera className="w-4 h-4" /> Use camera</> : <><Keyboard className="w-4 h-4" /> Enter manually</>}
          </button>
          {!supported && !showManual && (
            <p className="text-center text-xs text-amber-600 flex items-center justify-center gap-1">
              <CameraOff className="w-3 h-3" /> This browser lacks barcode scanning — use manual entry.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
