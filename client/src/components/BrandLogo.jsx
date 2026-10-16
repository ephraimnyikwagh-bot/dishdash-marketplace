export default function BrandLogo({ className = "h-10 w-10", tone = "light" }) {
  return (
    <img
      alt="Carted"
      className={`${className} object-contain`}
      src={tone === "dark" ? "/logo-dark.png" : "/logo-light.png"}
    />
  );
}
