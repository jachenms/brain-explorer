"use client";

import { Component, type ReactNode } from "react";

import { reportExhibitAssetError } from "@/lib/exhibit-loading-store";

type BrainSceneErrorBoundaryProps = Readonly<{
  attempt: number;
  children: ReactNode;
}>;

type BrainSceneErrorBoundaryState = Readonly<{
  error: Error | null;
}>;

export class BrainSceneErrorBoundary extends Component<
  BrainSceneErrorBoundaryProps,
  BrainSceneErrorBoundaryState
> {
  state: BrainSceneErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportExhibitAssetError(this.props.attempt, error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}
