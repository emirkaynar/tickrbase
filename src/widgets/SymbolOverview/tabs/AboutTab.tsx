import type { OverviewData } from "../../../services/types";
import styles from "../SymbolOverview.module.css";

type Props = {
    overview: OverviewData | null;
};

export function AboutTab({ overview }: Props) {
    return (
        <div className={styles.aboutTab}>
            <div className={styles.aboutHeader}>
                <div className={styles.aboutCompanyName}>
                    {overview?.company_name || overview?.symbol || "Company Info"}
                </div>
                <div className={styles.aboutTags}>
                    {overview?.sector && (
                        <span className={styles.aboutTag}>Sector: {overview.sector}</span>
                    )}
                    {overview?.industry && (
                        <span className={styles.aboutTag}>Industry: {overview.industry}</span>
                    )}
                </div>
            </div>

            <div className={styles.aboutBody}>
                {overview?.description ? (
                    <p className={styles.aboutDescription}>{overview.description}</p>
                ) : (
                    <div className={styles.aboutEmpty}>
                        Company description not available.
                    </div>
                )}
            </div>
        </div>
    );
}
