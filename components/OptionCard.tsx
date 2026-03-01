import type { ReactNode } from "react";

type OptionCardProps = {
  imageUrl: string;
  imageAlt: string;
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
  hideTitle?: boolean;
  className?: string;
  onClick?: () => void;
};

export function OptionCard({ imageUrl, imageAlt, title, meta, children, hideTitle = false, className, onClick }: OptionCardProps) {
  const classes = ["option", className].filter(Boolean).join(" ");
  return (
    <div className={classes} onClick={onClick}>
      <img alt={imageAlt} src={imageUrl} />
      {!hideTitle ? <strong>{title}</strong> : null}
      {meta ? <div className="small">{meta}</div> : null}
      {children}
    </div>
  );
}
