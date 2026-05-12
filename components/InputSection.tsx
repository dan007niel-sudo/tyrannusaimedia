import React, { useRef, useState } from 'react';
import { AppData } from '../types';
import { ArrowRight, Upload, X, Image as ImageIcon } from 'lucide-react';

interface InputSectionProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  onNext: () => void;
  isLoading: boolean;
}

const InputSection: React.FC<InputSectionProps> = ({ data, setData, onNext, isLoading }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const maxUploadBytes = 5 * 1024 * 1024;

  const loadFile = (file: File, resetInput?: () => void) => {
    if (!file) return;

    if (!allowedTypes.includes(file.type)) {
      setUploadError('Bitte JPG, PNG oder WebP verwenden.');
      resetInput?.();
      return;
    }

    if (file.size > maxUploadBytes) {
      setUploadError('Das Bild ist zu groß. Bitte maximal 5MB hochladen.');
      resetInput?.();
      return;
    }

    setUploadError(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      setData(prev => ({ ...prev, referenceImage: reader.result as string }));
    };
    reader.onerror = () => {
      setUploadError('Das Bild konnte nicht gelesen werden.');
      resetInput?.();
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file, () => { e.target.value = ''; });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const handleRemoveImage = () => {
    setData(prev => ({ ...prev, referenceImage: null }));
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      <div className="mx-auto max-w-2xl border-y border-black py-8 text-center space-y-4">
        <h2 className="font-brand-display text-5xl md:text-7xl font-black tracking-[-0.05em] leading-[0.88] text-black uppercase">
          Die Konzeption
        </h2>
        <p className="text-[#1F3A2E] font-medium text-base md:text-lg tracking-wide">
          Beginne mit dem Wort. Gestalte die Vision.
        </p>
      </div>

      <div className="space-y-8 bg-white/72 border border-black/10 p-5 md:p-8">
        <div className="space-y-3 group">
          <label className="flex items-center gap-2 text-[11px] font-black text-black uppercase tracking-widest">
            Bibelstelle / Referenz
          </label>
          <input
            type="text"
            value={data.verse}
            onChange={(e) => setData(prev => ({ ...prev, verse: e.target.value }))}
            placeholder="z.B. Römer 12:2"
            className="w-full bg-transparent border-b-2 border-[#D6C3A3] p-4 text-xl md:text-2xl font-light text-black placeholder-zinc-300 focus:border-black outline-none transition-all rounded-none"
          />
        </div>

        <div className="space-y-3 group">
          <label className="flex items-center gap-2 text-[11px] font-black text-black uppercase tracking-widest">
            Thematischer Fokus
          </label>
          <input
            type="text"
            value={data.theme}
            onChange={(e) => setData(prev => ({ ...prev, theme: e.target.value }))}
            placeholder="z.B. Erneuerung des Sinnes"
            className="w-full bg-transparent border-b-2 border-[#D6C3A3] p-4 text-xl md:text-2xl font-light text-black placeholder-zinc-300 focus:border-black outline-none transition-all rounded-none"
          />
        </div>

        <div className="space-y-3 group pt-4">
          <label className="flex items-center gap-2 text-[11px] font-black text-zinc-600 uppercase tracking-widest">
            Konkrete Elemente / Symbole (Optional)
          </label>
          <textarea
            value={data.userVision}
            onChange={(e) => setData(prev => ({ ...prev, userVision: e.target.value }))}
            placeholder="Hast du schon ein Bild im Kopf? Z.B. 'Ein alter Olivenbaum im Sturm', 'Goldene Risse im Beton', 'Moderne Architektur bei Nacht'..."
            className="w-full bg-[#fbfaf7] border border-black/10 p-4 text-lg font-light text-black placeholder-zinc-300 focus:border-black focus:bg-white outline-none transition-all resize-none h-32"
          />
        </div>

        {/* Style Selection */}
        <div className="space-y-3 group pt-4">
          <label className="flex items-center gap-2 text-[11px] font-black text-zinc-600 uppercase tracking-widest">
            Stilrichtung
          </label>
          <div className="flex gap-4">
            <button
              onClick={() => setData(prev => ({ ...prev, styleMode: 'classic' }))}
              className={`flex-1 py-4 px-6 border transition-all uppercase tracking-widest text-xs font-bold ${
                data.styleMode === 'classic'
                  ? 'bg-black text-white border-black'
                  : 'bg-[#fbfaf7] text-zinc-500 border-black/10 hover:border-black'
              }`}
            >
              Klassisch / Zeitlos
            </button>
            <button
              onClick={() => setData(prev => ({ ...prev, styleMode: 'modern' }))}
              className={`flex-1 py-4 px-6 border transition-all uppercase tracking-widest text-xs font-bold ${
                data.styleMode === 'modern'
                  ? 'bg-[#1F3A2E] text-white border-[#1F3A2E]'
                  : 'bg-[#fbfaf7] text-zinc-500 border-black/10 hover:border-black'
              }`}
            >
              Modern / Editorial
            </button>
          </div>
        </div>

        {/* Image Upload */}
        <div className="space-y-3 group pt-4">
          <label className="flex items-center gap-2 text-[11px] font-black text-zinc-600 uppercase tracking-widest">
            Referenzbild (Optional)
          </label>

          {!data.referenceImage ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="w-full border border-dashed border-[#8FA79B] hover:border-black hover:bg-[#f5f2eb] transition-all p-8 flex flex-col items-center justify-center gap-4 cursor-pointer group/upload"
            >
              <div className="p-4 bg-white border border-black/10 group-hover/upload:border-black transition-colors">
                <Upload className="text-[#1F3A2E] group-hover/upload:text-black transition-colors" size={24} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-600">Bild hochladen oder hierher ziehen</p>
                <p className="text-xs text-zinc-400 mt-1">JPG, PNG, WebP bis 5MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          ) : (
            <div className="relative w-full aspect-video bg-zinc-100 overflow-hidden border border-black/10 group/image">
              <img
                src={data.referenceImage}
                alt="Reference"
                className="w-full h-full object-cover opacity-80 group-hover/image:opacity-100 transition-opacity"
              />
              <div className="absolute inset-0 bg-black/0 group-hover/image:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover/image:opacity-100">
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveImage(); }}
                  className="bg-white/90 hover:bg-white text-red-500 p-3 border border-black/10 shadow-lg transition-transform hover:scale-105"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="absolute bottom-3 left-3 bg-black/80 text-white text-[10px] uppercase tracking-widest px-2 py-1 backdrop-blur-sm">
                Referenz aktiv
              </div>
            </div>
          )}
          {uploadError && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-sm">
              {uploadError}
            </p>
          )}
        </div>

        <div className="pt-8">
            <button
            onClick={onNext}
            disabled={!data.verse || !data.theme || isLoading}
            className="w-full bg-black hover:bg-[#1F3A2E] disabled:bg-zinc-100 disabled:text-zinc-300 text-white font-bold py-6 px-8 transition-all flex items-center justify-center gap-4 group shadow-xl shadow-zinc-200/50"
            >
            {isLoading ? (
                <span className="uppercase tracking-widest text-xs animate-pulse">Konsultiere Art Director...</span>
            ) : (
                <>
                <span className="uppercase tracking-widest text-sm">Konzepte Entwickeln</span>
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </>
            )}
            </button>
        </div>
      </div>
    </div>
  );
};

export default InputSection;
