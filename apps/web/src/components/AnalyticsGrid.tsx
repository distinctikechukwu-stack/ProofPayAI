import { ClientSideRowModelModule, createGrid, ModuleRegistry, PaginationModule, TextFilterModule, themeQuartz, type ColDef, type GridApi } from "ag-grid-community";
import { useEffect, useRef } from "react";
import type { AnalyticsGridRow } from "../types/analytics";

ModuleRegistry.registerModules([ClientSideRowModelModule, PaginationModule, TextFilterModule]);

interface AnalyticsGridProps {
  rowData: AnalyticsGridRow[];
  columnDefs: ColDef<AnalyticsGridRow>[];
  theme: {
    accentColor: string;
    backgroundColor: string;
    foregroundColor: string;
    headerBackgroundColor: string;
    spacing: number;
  };
}

export function AnalyticsGrid({ rowData, columnDefs, theme }: AnalyticsGridProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GridApi<AnalyticsGridRow> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const api = createGrid(hostRef.current, {
      theme: themeQuartz.withParams(theme),
      rowData,
      columnDefs,
      defaultColDef: { sortable: true, filter: true, resizable: true },
      pagination: true,
      paginationPageSize: 10,
    });
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, [columnDefs, theme]);

  useEffect(() => {
    apiRef.current?.setGridOption("rowData", rowData);
  }, [rowData]);

  return <div className="analytics-grid-shell" ref={hostRef} />;
}
