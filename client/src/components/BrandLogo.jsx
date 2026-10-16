import { useState } from "react";

export default function BrandLogo({ className = "h-10 w-10" }) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      alt="DishDash"
      className={`${className} rounded-xl object-contain`}
      onError={() => setFailed(true)}
      src={failed ? "/brand-mark.svg" : "/logo.png"}
    />
  );
}
