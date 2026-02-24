import "./app.css";
import { TopBar } from "./components/TopBar";
import { GridLayout } from "./grid/GridLayout";
import { StockChart } from "./widgets/StockChart";

export function App() {
    return (
        <>
            <TopBar />
            <div class="grid-area">
                <GridLayout>
                    <div key="stock-chart-0" style={{ height: "100%" }}>
                        <StockChart id="stock-chart-0" />
                    </div>
                </GridLayout>
            </div>
        </>
    );
}
