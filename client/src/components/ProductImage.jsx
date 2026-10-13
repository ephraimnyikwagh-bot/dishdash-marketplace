import { useState } from "react";

export default function ProductImage({ src, name }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-orange-50">
      {!failed && src ? (
        <img
          alt={name}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          onError={() => setFailed(true)}
          src={src}
        />
      ) : (
        <img
          alt=""
          className="h-full w-full object-cover"
          src="/food-placeholder.svg"
        />
      )}
    </div>
  );
}
