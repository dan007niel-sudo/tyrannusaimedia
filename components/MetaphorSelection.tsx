import React from 'react';
import { AppData, AspectRatio } from '../types';
import { Image as ImageIcon, Check, ChevronLeft, Loader2, Settings2 } from 'lucide-react';

interface MetaphorSelectionProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  onGenerate: () => void;
  onBack: () => void;
  isLoading: boolean;
}

const MetaphorSelection: React.FC<MetaphorSelectionProps> = ({ data, setData, onGenerate, onBack, isLoading }) => {
  const handleSelect = (id: string) => {
    setData(prev => ({ ...prev, selectedMetaphorId: id }));
  };

  const toggleFormat = (key: keyof typeof data.selectedFormats) => {
      setData(prev => ({
          ...prev,
          selectedFormats: {
              ...prev.selectedFormats,
              [key]: !prev.selectedFormats[key]
          }
      }));
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-20">
      
      {/* Header Nav */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-6">
        <button onClick={onBack} className="text-zinc-400 hover:text-black flex items-center gap-2 transition-colors uppercase tracking-widest text-xs font-bold">
          <ChevronLeft size={16} /> Zurück
        </button>
        <div className="text-center">
          <h2 className="text-xl font-bold tracking-widest uppercase text-black">Visuelle Richtung</h2>
        </div>
        <div className="w-20" /> 
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {data.metaphors.map((metaphor) => {
          const isSelected = data.selectedMetaphorId === metaphor.id;
          return (
            <div
              key={metaphor.id}
              onClick={() => handleSelect(metaphor.id)}
              className={`
                relative p-8 border cursor-pointer transition-all duration-300 h-full flex flex-col group
                ${isSelected 
                  ? 'bg-black text-white border-black shadow-2xl scale-[1.02]' 
                  : 'bg-white text-black border-zinc-200 hover:border-black hover:shadow-lg'
                }
              `}
            >
              <div className="flex justify-between items-start mb-6">
                <h3 className={`text-2xl font-bold tracking-tight ${isSelected ? 'text-white' : 'text-black'}`}>
                    {metaphor.title}
                </h3>
                {isSelected && <Check size={24} className="text-white" />}
              </div>
              <p className={`text-sm leading-relaxed mb-8 flex-grow font-light ${isSelected ? 'text-zinc-300' : 'text-zinc-600'}`}>
                {metaphor.description}
              </p>
              <div className={`mt-auto pt-6 border-t ${isSelected ? 'border-zinc-800' : 'border-zinc-100'}`}>
                 <p className={`text-[10px] uppercase tracking-widest font-bold mb-3 ${isSelected ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Visual Prompt (Intern)
                 </p>
                 <p className={`text-xs font-mono line-clamp-3 ${isSelected ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {metaphor.visualPrompt}
                 </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Configuration & Controls */}
      <div className="flex flex-col items-center justify-center space-y-8 pt-8 border-t border-zinc-100">
         
         <div className="w-full max-w-3xl space-y-6">
            <div className="flex items-center justify-center gap-2 text-black mb-4">
                <Settings2 size={16} />
                <h3 className="font-bold text-xs uppercase tracking-widest">Format Einstellungen</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Image Size Selection */}
                <div className="col-span-full flex justify-center gap-4 mb-4">
                    {(['1K', '2K', '4K'] as const).map(size => (
                        <button
                            key={size}
                            onClick={() => setData(prev => ({...prev, imageSize: size}))}
                            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded-sm border ${
                                data.imageSize === size 
                                ? 'bg-black text-white border-black' 
                                : 'bg-white text-zinc-400 border-zinc-200 hover:border-black hover:text-black'
                            }`}
                        >
                            Auflösung: {size}
                        </button>
                    ))}
                </div>

                {/* Format Toggles */}
                <label className={`flex items-center justify-between p-4 border cursor-pointer transition-all ${data.selectedFormats.feed ? 'border-black bg-zinc-50' : 'border-zinc-100'}`}>
                    <span className="text-xs font-bold uppercase tracking-widest">Feed (4:5)</span>
                    <input 
                        type="checkbox" 
                        checked={data.selectedFormats.feed} 
                        onChange={() => toggleFormat('feed')}
                        className="accent-black h-4 w-4"
                    />
                </label>

                <label className={`flex items-center justify-between p-4 border cursor-pointer transition-all ${data.selectedFormats.story ? 'border-black bg-zinc-50' : 'border-zinc-100'}`}>
                    <span className="text-xs font-bold uppercase tracking-widest">Story (9:16)</span>
                    <input 
                        type="checkbox" 
                        checked={data.selectedFormats.story} 
                        onChange={() => toggleFormat('story')}
                        className="accent-black h-4 w-4"
                    />
                </label>

                <label className={`flex items-center justify-between p-4 border cursor-pointer transition-all ${data.selectedFormats.banner ? 'border-black bg-zinc-50' : 'border-zinc-100'}`}>
                    <span className="text-xs font-bold uppercase tracking-widest">Banner (16:9)</span>
                    <input 
                        type="checkbox" 
                        checked={data.selectedFormats.banner} 
                        onChange={() => toggleFormat('banner')}
                        className="accent-black h-4 w-4"
                    />
                </label>

                <div className={`flex flex-col p-3 border transition-all ${data.selectedFormats.custom ? 'border-black bg-zinc-50' : 'border-zinc-100'}`}>
                    <label className="flex items-center justify-between mb-2 cursor-pointer">
                        <span className="text-xs font-bold uppercase tracking-widest">Benutzerdefiniert</span>
                        <input 
                            type="checkbox" 
                            checked={data.selectedFormats.custom} 
                            onChange={() => toggleFormat('custom')}
                            className="accent-black h-4 w-4"
                        />
                    </label>
                    <select 
                        disabled={!data.selectedFormats.custom}
                        value={data.customRatio}
                        onChange={(e) => setData(prev => ({...prev, customRatio: e.target.value as AspectRatio}))}
                        className="w-full text-xs border border-zinc-200 p-2 bg-white outline-none focus:border-black disabled:opacity-50"
                    >
                        <option value="1:1">1:1 (Quadrat)</option>
                        <option value="4:3">4:3 (Standard)</option>
                        <option value="3:4">3:4 (Portrait)</option>
                        <option value="16:9">16:9 (Landscape)</option>
                        <option value="9:16">9:16 (Vertical)</option>
                    </select>
                </div>
            </div>
         </div>

        <button
          onClick={onGenerate}
          disabled={!data.selectedMetaphorId || isLoading || (!data.selectedFormats.feed && !data.selectedFormats.story && !data.selectedFormats.banner && !data.selectedFormats.custom)}
          className="w-full max-w-sm bg-black hover:bg-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-300 text-white font-bold py-5 px-8 rounded-full transition-all flex items-center justify-center gap-3 shadow-2xl mt-8"
        >
          {isLoading ? (
             <><Loader2 className="animate-spin" /> <span className="uppercase tracking-widest text-xs">Produziere Assets...</span></>
          ) : (
            <><ImageIcon size={18} /> <span className="uppercase tracking-widest text-xs">Ausgewählte Formate Generieren</span></>
          )}
        </button>
      </div>
    </div>
  );
};

export default MetaphorSelection;