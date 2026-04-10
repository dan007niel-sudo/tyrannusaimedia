import React, { useRef } from 'react';
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setData(prev => ({ ...prev, referenceImage: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setData(prev => ({ ...prev, referenceImage: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      <div className="text-center space-y-4">
        <h2 className="text-5xl font-black tracking-tighter text-black uppercase">
          Die Konzeption
        </h2>
        <p className="text-zinc-500 font-light text-lg tracking-wide">
          Beginne mit dem Wort. Gestalte die Vision.
        </p>
      </div>

      <div className="space-y-8">
        <div className="space-y-3 group">
          <label className="flex items-center gap-2 text-xs font-bold text-black uppercase tracking-widest">
            Bibelstelle / Referenz
          </label>
          <input
            type="text"
            value={data.verse}
            onChange={(e) => setData(prev => ({ ...prev, verse: e.target.value }))}
            placeholder="z.B. Römer 12:2"
            className="w-full bg-white border-b-2 border-zinc-100 p-4 text-2xl font-light text-black placeholder-zinc-200 focus:border-black outline-none transition-all rounded-none"
          />
        </div>

        <div className="space-y-3 group">
          <label className="flex items-center gap-2 text-xs font-bold text-black uppercase tracking-widest">
            Thematischer Fokus
          </label>
          <input
            type="text"
            value={data.theme}
            onChange={(e) => setData(prev => ({ ...prev, theme: e.target.value }))}
            placeholder="z.B. Erneuerung des Sinnes"
            className="w-full bg-white border-b-2 border-zinc-100 p-4 text-2xl font-light text-black placeholder-zinc-200 focus:border-black outline-none transition-all rounded-none"
          />
        </div>

        <div className="space-y-3 group pt-4">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
            Konkrete Elemente / Symbole (Optional)
          </label>
          <textarea
            value={data.userVision}
            onChange={(e) => setData(prev => ({ ...prev, userVision: e.target.value }))}
            placeholder="Hast du schon ein Bild im Kopf? Z.B. 'Ein alter Olivenbaum im Sturm', 'Goldene Risse im Beton', 'Moderne Architektur bei Nacht'..."
            className="w-full bg-zinc-50 border border-zinc-200 p-4 text-lg font-light text-black placeholder-zinc-300 focus:border-black focus:bg-white outline-none transition-all rounded-sm resize-none h-32"
          />
        </div>

        {/* Style Selection */}
        <div className="space-y-3 group pt-4">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
            Stilrichtung
          </label>
          <div className="flex gap-4">
            <button
              onClick={() => setData(prev => ({ ...prev, styleMode: 'classic' }))}
              className={`flex-1 py-4 px-6 border transition-all uppercase tracking-widest text-xs font-bold ${
                data.styleMode === 'classic' 
                  ? 'bg-black text-white border-black' 
                  : 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'
              }`}
            >
              Klassisch / Zeitlos
            </button>
            <button
              onClick={() => setData(prev => ({ ...prev, styleMode: 'modern' }))}
              className={`flex-1 py-4 px-6 border transition-all uppercase tracking-widest text-xs font-bold ${
                data.styleMode === 'modern' 
                  ? 'bg-black text-white border-black' 
                  : 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'
              }`}
            >
              Modern / Editorial
            </button>
          </div>
        </div>

        {/* Image Upload */}
        <div className="space-y-3 group pt-4">
          <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest">
            Referenzbild (Optional)
          </label>
          
          {!data.referenceImage ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 transition-all p-8 flex flex-col items-center justify-center gap-4 cursor-pointer rounded-sm group/upload"
            >
              <div className="p-4 bg-zinc-50 rounded-full group-hover/upload:bg-white transition-colors">
                <Upload className="text-zinc-400 group-hover/upload:text-black transition-colors" size={24} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-600">Bild hochladen oder hierher ziehen</p>
                <p className="text-xs text-zinc-400 mt-1">JPG, PNG bis 5MB</p>
              </div>
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleFileChange}
              />
            </div>
          ) : (
            <div className="relative w-full aspect-video bg-zinc-100 rounded-sm overflow-hidden border border-zinc-200 group/image">
              <img 
                src={data.referenceImage} 
                alt="Reference" 
                className="w-full h-full object-cover opacity-80 group-hover/image:opacity-100 transition-opacity"
              />
              <div className="absolute inset-0 bg-black/0 group-hover/image:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover/image:opacity-100">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleRemoveImage(); }}
                  className="bg-white/90 hover:bg-white text-red-500 p-3 rounded-full shadow-lg transition-transform hover:scale-105"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="absolute bottom-3 left-3 bg-black/70 text-white text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm backdrop-blur-sm">
                Referenz aktiv
              </div>
            </div>
          )}
        </div>

        <div className="pt-8">
            <button
            onClick={onNext}
            disabled={!data.verse || !data.theme || isLoading}
            className="w-full bg-black hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-300 text-white font-bold py-6 px-8 transition-all flex items-center justify-center gap-4 group rounded-sm shadow-xl shadow-zinc-200/50"
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