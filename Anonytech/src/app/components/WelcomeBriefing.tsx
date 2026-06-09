import React, { useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { CheckSquare, Clock, Database, Shield, ShieldCheck, AlertTriangle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setCoercionMode } from "../utils/dataStore";

export function WelcomeBriefing() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'sw' ? 'KS' : 'EN';
  const [selectedToken, setSelectedToken] = useState<number | null>(null);
  const [showCoercionExplainer, setShowCoercionExplainer] = useState(false);

  const handleTokenSelect = (tokenId: number) => {
    if (tokenId === 1) {
      setShowCoercionExplainer(true);
    } else {
      setCoercionMode(false);
      setSelectedToken(2);
      setTimeout(() => navigate("/ballot"), 800);
    }
  };

  const handleCoercionProceed = () => {
    setCoercionMode(true);
    setTimeout(() => navigate("/ballot"), 600);
  };

  return (
    <div className="flex h-[100dvh] w-full items-center justify-center p-8 relative z-10 bg-[#F8FAFC]">
      {/* Header */}
      <div className="absolute top-0 left-0 w-full px-8 py-5 flex justify-between items-center z-50">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#0D5D56]" />
          <span className="font-['Figtree'] font-bold text-xl text-[#0D5D56]">{t("AnonyTech")}</span>
        </div>
        <div className="flex items-center bg-white border border-[#A7F3D0] rounded-full p-1 shadow-sm">
          <button onClick={() => i18n.changeLanguage("en")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${language === "EN" ? "bg-[#0D5D56] text-[#A7F3D0]" : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"}`}>EN</button>
          <button onClick={() => i18n.changeLanguage("sw")} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${language === "KS" ? "bg-[#0D5D56] text-[#A7F3D0]" : "text-[#0D5D56] hover:bg-[#A7F3D0]/20"}`}>KS</button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!showCoercionExplainer ? (
          <motion.div
            key="briefing"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-5xl max-h-[90vh] overflow-y-auto hide-scrollbar bg-white border border-[#A7F3D0] rounded-[40px] p-8 md:p-12 shadow-[0_24px_60px_rgba(13,93,86,0.15)] text-center relative"
          >
            <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#A7F3D0]/20 rounded-full mix-blend-multiply opacity-80 blur-3xl pointer-events-none" />

            <div className="flex flex-col items-center justify-center gap-2 mb-8 relative z-10">
              <Shield className="w-10 h-10 text-[#0D5D56]" />
              <h1 className="font-['Figtree'] text-3xl md:text-5xl font-bold text-[#0D5D56] tracking-tight">
                {t("Master Instructions")}
              </h1>
              <p className="text-lg md:text-xl font-bold text-[#0D5D56]/80 mt-2">
                {t("Read carefully. You are entering a strictly linear, zero-evidence environment.")}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 text-left relative z-10">
              <div className="bg-[#F8FAFC] rounded-[32px] p-6 shadow-sm border border-[#A7F3D0]/50 hover:bg-white hover:border-[#0D5D56]/30 transition-all flex flex-col gap-4">
                <div className="bg-[#0D5D56] w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner">
                  <CheckSquare className="text-[#A7F3D0] w-6 h-6" />
                </div>
                <h3 className="font-bold text-lg text-[#0D5D56]">{t("Linear Tunnel")}</h3>
                <p className="text-sm font-bold text-[#0D5D56]/70 leading-relaxed">
                  {t("Once you start, you cannot go back. Exiting or refreshing will void this session.")}
                </p>
              </div>

              <div className="bg-[#F8FAFC] rounded-[32px] p-6 shadow-sm border border-[#A7F3D0]/50 hover:bg-white hover:border-[#0D5D56]/30 transition-all flex flex-col gap-4">
                <div className="bg-[#0D5D56] w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner">
                  <Clock className="text-[#A7F3D0] w-6 h-6" />
                </div>
                <h3 className="font-bold text-lg text-[#0D5D56]">{t("Temporal Masking")}</h3>
                <p className="text-sm font-bold text-[#0D5D56]/70 leading-relaxed">
                  A brief security window protects your submission. Your vote cannot be timed or fingerprinted.
                </p>
              </div>

              <div className="bg-[#F8FAFC] rounded-[32px] p-6 shadow-sm border border-[#A7F3D0]/50 hover:bg-white hover:border-[#0D5D56]/30 transition-all flex flex-col gap-4">
                <div className="bg-[#0D5D56] w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner">
                  <Database className="text-[#A7F3D0] w-6 h-6" />
                </div>
                <h3 className="font-bold text-lg text-[#0D5D56]">{t("Disaster Recovery")}</h3>
                <p className="text-sm font-bold text-[#0D5D56]/70 leading-relaxed">
                  {t("Your state is protected against system or power failures via our distributed resilience ledger.")}
                </p>
              </div>
            </div>

            <div className="w-full h-px bg-[#A7F3D0]/30 mb-10 relative z-10" />

            <div className="relative z-10 flex flex-col items-center">
              <h2 className="font-['Figtree'] text-2xl font-bold tracking-tight text-[#0D5D56] mb-3">
                {t("The Double Shield")}
              </h2>
              <p className="text-sm md:text-base font-bold text-[#0D5D56]/80 leading-relaxed mb-8 max-w-2xl text-center">
                {t("You are about to start voting. Choose your mode:")}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full">
                {[1, 2].map((tokenId) => (
                  <motion.button
                    key={tokenId}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTokenSelect(tokenId)}
                    className={`p-6 rounded-[32px] border-2 bg-[#F8FAFC] shadow-sm flex flex-col items-center gap-4 transition-all text-left w-full cursor-pointer group ${
                      selectedToken === tokenId
                        ? "ring-4 ring-[#A7F3D0] border-[#0D5D56] bg-white"
                        : "border-[#A7F3D0] hover:border-[#0D5D56] hover:bg-white"
                    }`}
                  >
                    <div className="w-16 h-16 rounded-full bg-[#0D5D56] flex items-center justify-center shadow-inner shrink-0 group-hover:scale-110 transition-transform">
                      <ShieldCheck className="w-8 h-8 text-[#A7F3D0]" />
                    </div>
                    <div className="flex flex-col items-center">
                      <h3 className="font-['Figtree'] text-xl font-bold text-[#0D5D56] mb-2 text-center">
                        {tokenId === 1 ? t("Mode A") : t("Mode B")}
                      </h3>
                      <p className="text-xs font-bold text-[#0D5D56]/70 leading-relaxed text-center">
                        {tokenId === 1
                          ? t("A safety mode. Use this if you are being coerced (forced) to vote. You can log in later to vote again; this session will be ignored.")
                          : t("Your official and final vote. This mode can only be used once.")}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          // Coercion resistance explainer screen
          <motion.div
            key="coercion-explainer"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="w-full max-w-2xl bg-[#0D5D56] rounded-[40px] p-10 shadow-[0_24px_60px_rgba(13,93,86,0.3)] text-center relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#A7F3D0] rounded-full blur-[100px] opacity-10 pointer-events-none" />

            <div className="relative z-10">
              <div className="w-20 h-20 bg-white/10 border border-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertTriangle className="w-10 h-10 text-[#A7F3D0]" />
              </div>

              <span className="inline-block px-4 py-1.5 bg-amber-400/20 border border-amber-400/30 text-amber-300 text-xs font-bold rounded-full mb-4 uppercase tracking-widest">
                Coercion Protection Active
              </span>

              <h2 className="font-['Figtree'] text-3xl font-bold text-white mb-4 leading-tight">
                Mode A — Safety Vote
              </h2>

              <p className="text-white/70 font-bold text-sm leading-relaxed mb-8 max-w-lg mx-auto">
                You are about to cast a <span className="text-[#A7F3D0]">decoy ballot</span>. This vote will appear completely legitimate to anyone watching — but it will <span className="text-[#A7F3D0]">not be counted</span> in the final tally.
              </p>

              <div className="bg-white/10 border border-white/20 rounded-[28px] p-6 mb-8 text-left space-y-4">
                {[
                  ["Your real vote is safe", "You can log in again after this session using Mode B to cast your actual vote. No one can tell the difference."],
                  ["This ballot looks real", "Your decoy vote will appear on the public bulletin board with a valid ZKP proof, indistinguishable from a real ballot."],
                  ["Zero evidence", "No receipt, no record, and no way for a coercer to verify this was a decoy."],
                ].map(([title, desc]) => (
                  <div key={title} className="flex gap-3">
                    <ShieldCheck size={18} className="text-[#A7F3D0] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white font-bold text-sm">{title}</p>
                      <p className="text-white/60 text-xs font-bold mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setShowCoercionExplainer(false)}
                  className="flex-1 py-4 rounded-[20px] bg-white/10 border border-white/20 text-white font-bold hover:bg-white/20 transition-colors"
                >
                  Go Back
                </button>
                <button
                  onClick={handleCoercionProceed}
                  className="flex-1 py-4 rounded-[20px] bg-[#A7F3D0] text-[#0D5D56] font-bold hover:bg-[#A7F3D0]/90 transition-colors flex items-center justify-center gap-2 shadow-lg"
                >
                  Proceed with Safety Vote <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}