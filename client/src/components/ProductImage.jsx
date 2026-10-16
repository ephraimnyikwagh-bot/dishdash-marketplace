import { useState } from "react";
import { apiOrigin } from "../api.js";

export default function ProductImage({ src, name }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = src?.startsWith("/") ? `${apiOrigin}${src}` : src;
  return (
    <div className="group flex aspect-[4/3] items-center justify-center overflow-hidden bg-orange-50">
      {!failed && imageUrl ? (
        <img
          alt={`${name} food`}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          src={imageUrl}
        />
      ) : (
        <img
          alt={`${name} image placeholder`}
          className="h-full w-full object-cover"
          loading="lazy"
          src="/food-placeholder.svg"
        />
      )}
    </div>
  );
}
