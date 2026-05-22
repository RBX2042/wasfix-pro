"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Camera, X, Loader2, Sparkles } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

export type ImageAnalysisResult = {
  detectedCode: string | null;
  detectedBrand: string | null;
  detectedSymptom: string | null;
  confidence: number;
  description: string;
  suggestedQuery: string;
  matchedErrorCode?: { id: string; code: string; title: string; description: string } | null;
  recommendedParts?: Array<{ id: string; sku: string; name: string; brand: string; priceEur: number; imageUrl: string | null; stock: number }>;
  recommendedGuides?: Array<{ id: string; slug: string; title: string; difficulty: string; timeMinutes: number; summary: string }>;
};

interface Props {
  onAnalysis: (result: ImageAnalysisResult, previewUrl: string) => void;
}

export default function ImageUpload({ onAnalysis }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const f = acceptedFiles[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast.error("Afbeelding mag maximaal 10MB zijn");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 1,
    disabled: isLoading,
  });

  async function analyzeImage() {
    if (!file || !preview) return;
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/diagnose/image", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Foto analyse mislukt");
      onAnalysis(data, preview);
      // keep preview so user sees what was analyzed
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Foto analyse mislukt");
    } finally {
      setIsLoading(false);
    }
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
  }

  if (preview) {
    return (
      <div className="space-y-3">
        <div className="relative w-full h-56 rounded-xl overflow-hidden border-2 border-primary bg-muted">
          <Image src={preview} alt="Geüploade foto" fill className="object-cover" unoptimized />
          <button
            onClick={reset}
            disabled={isLoading}
            className="absolute top-2 right-2 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80 disabled:opacity-50"
            aria-label="Foto verwijderen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={analyzeImage}
          disabled={isLoading}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-60 transition-all"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Foto analyseren...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> Analyseer met AI
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
        isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"
      }`}
    >
      <input {...getInputProps()} />
      <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm font-medium">
        {isDragActive ? "Laat los om te uploaden" : "Foto uploaden of klik hier"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Foutcode op display, defect onderdeel of waterlek
      </p>
      <div className="mt-3 flex gap-2 justify-center">
        <span className="px-2 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">JPG</span>
        <span className="px-2 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">PNG</span>
        <span className="px-2 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">Max 10MB</span>
      </div>
    </div>
  );
}
