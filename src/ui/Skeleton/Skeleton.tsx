import styles from "./Skeleton.module.css";

type SkeletonVariant = "rect" | "text" | "circle";

type Props = {
    variant?: SkeletonVariant;
    width?: string | number;
    height?: string | number;
    className?: string;
};

export function Skeleton({
    variant = "rect",
    width,
    height,
    className,
}: Props) {
    const style: Record<string, string> = {};
    if (width !== undefined)
        style["width"] = typeof width === "number" ? `${width}px` : width;
    if (height !== undefined)
        style["height"] = typeof height === "number" ? `${height}px` : height;

    return (
        <div
            class={[styles.skeleton, styles[variant], className]
                .filter(Boolean)
                .join(" ")}
            style={style}
            aria-hidden="true"
        />
    );
}
