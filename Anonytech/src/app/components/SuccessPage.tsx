import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, Lock, Trash2 } from "lucide-react";

export function SuccessPage() {
  const [timeLeft, setTimeLeft] = useState(8);
  const navigate = useNavigate();

  useEffect(() => {
    if (timeLeft <= 0) {
      navigate("/dashboard");
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, navigate]);

  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center relative overflow-hidden bg-[#F8FAFC]">

      {/* Background Decor */}
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, delay: 0.2 }}
        className="absolute w-[500px] h-[500px] bg-[#A7F3D0]/40 rounded-full blur-[100px] pointer-events-none"
      />

      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="flex flex-col items-center max-w-lg z-10 bg-white/70 p-12 rounded-[40px] backdrop-blur-xl border border-white shadow-[0_16px_40px_rgba(13,93,86,0.1)] relative"
        >

          <div className="absolute top-0 right-0 p-6 opacity-30">
            <ShieldCheck size={120} className="text-[#0D5D56]" />
          </div>

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 200,
              damping: 15,
              delay: 0.3,
            }}
            className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-[#0D5D56] shadow-[0_8px_20px_rgba(13,93,86,0.3)] border-4 border-[#A7F3D0] relative z-10"
          >
            <motion.div
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.8 }}
            >
              <Lock className="h-10 w-10 text-[#A7F3D0]" strokeWidth={3} />
            </motion.div>
          </motion.div>

          <h1 className="mb-4 font-['Figtree'] text-4xl font-bold tracking-tight text-[#0D5D56] relative z-10">
            Vote Recorded Successfully
          </h1>

          <div className="bg-[#A7F3D0]/20 border border-[#A7F3D0] rounded-[24px] p-6 mb-10 relative z-10 w-full text-left flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-[#0D5D56] flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-[#0D5D56] text-lg mb-1">Zero-Evidence Guarantee</h3>
              <p className="text-sm font-medium leading-relaxed text-[#0D5D56]/80">
                All local metadata has been purged for your protection. No digital receipt was generated. Your choices remain entirely anonymous.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs font-bold text-[#0D5D56]/60 bg-white px-5 py-3 rounded-full border border-[#A7F3D0]/50 shadow-sm relative z-10">
            <span>Session terminating and returning to dashboard in {timeLeft}s</span>
            <div className="h-2 w-2 rounded-full bg-[#10B981] animate-pulse" />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}