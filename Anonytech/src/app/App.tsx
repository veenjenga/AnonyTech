import { RouterProvider } from "react-router";
import { router } from "./routes";
import "./i18n/config";

// Force HMR reload to align Context instances
export default function App() {
  return (
    <div className="font-['Manrope',sans-serif] antialiased min-h-screen relative bg-[#F8FAFC] overflow-hidden text-[#136F63] flex items-center justify-center p-4 md:p-8">
      
      {/* Animated Soft Background Gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-[#C5FFFD] rounded-full mix-blend-overlay filter blur-[100px] opacity-80 pointer-events-none animate-[pulse_8s_ease-in-out_infinite]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#C5FFFD] rounded-full mix-blend-overlay filter blur-[150px] opacity-40 pointer-events-none animate-[pulse_10s_ease-in-out_infinite]" />

      {/* Main Glass App Window matching Hourglass UI */}
      <div className="relative z-10 w-full max-w-[1440px] h-full max-h-[900px] bg-white/40 backdrop-blur-3xl border border-white/60 rounded-[40px] shadow-[0_24px_64px_rgba(19,111,99,0.1)] overflow-hidden flex flex-col">
        <RouterProvider router={router} />
      </div>
    </div>
  );
}
