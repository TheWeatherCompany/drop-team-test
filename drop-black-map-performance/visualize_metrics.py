#!/usr/bin/env python3
"""
Performance Metrics Visualization

Generates a multi-page PDF analysis from a performance-test CSV.

Always generated:
- Page 1: Memory Performance Analysis
- Page 2: CPU Performance Analysis
- Page 3: FPS Performance Analysis
- Page 4: Cumulative Memory Growth Analysis

Generated only when the CSV contains PHASE markers:
- Page 5: Phase-by-Phase Comparison
- Page 6: Phase Overlay Comparison
- Page 7: Combined Performance Timeline

Usage:
    python3 visualize_metrics.py <csv_file>
"""

import sys
import re
import json
import textwrap
import pandas as pd
import matplotlib.pyplot as plt
import os
from urllib.parse import urlparse
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, Patch
import numpy as np

# FPS is only meaningful while the map is actively being driven. requestAnimation-
# Frame reads ~60 on a visible-but-idle page, so samples taken during static holds
# (labeled e.g. "Setup" / "Changing map mode") and setup/teardown rows would
# inflate the average and mask real interaction jank. Restrict FPS stats to these
# active-movement actions. (Memory/CPU still use every row.)
ACTIVE_FPS_ACTIONS = {'Panning and zooming', 'Pan only (L/R)', 'Zoom only (in/out)',
                      'Timebar playback (static, US)'}


def active_fps(frame):
    """FPS values for active-movement rows only (idle holds excluded)."""
    if 'Action' not in frame or 'FPS' not in frame:
        return pd.Series([], dtype=float)
    return pd.to_numeric(
        frame.loc[frame['Action'].isin(ACTIVE_FPS_ACTIONS), 'FPS'], errors='coerce'
    ).dropna()


def _read_metrics_csv(csv_file):
    """Robustly read the metrics CSV.

    The first 5 fields (timestamp, elapsed, memory, cpu, fps) never contain
    commas, but the Action can (e.g. "Timebar playback (static, US)"). Older runs
    wrote the action UNQUOTED, so a plain pd.read_csv errors ("saw 7 fields") and
    drops those rows — which are the highest-memory timebar samples. Split on only
    the first 5 commas so everything after is the action, whether quoted or not,
    and salvage every row.
    """
    with open(csv_file, 'r') as fh:
        lines = [ln.rstrip('\n') for ln in fh if ln.strip()]
    header = lines[0].split(',')
    rows = []
    for ln in lines[1:]:
        parts = ln.split(',', 5)
        if len(parts) < 6:
            continue
        action = parts[5]
        if len(action) >= 2 and action.startswith('"') and action.endswith('"'):
            action = action[1:-1].replace('""', '"')
        parts[5] = action
        rows.append(parts)
    return pd.DataFrame(rows, columns=header)


def load_data(csv_file):
    """Load and clean CSV data."""
    print(f"📊 Loading data from {csv_file}...")

    df = _read_metrics_csv(csv_file)

    # Remove statistics rows
    df = df[~df['Action'].str.contains(r'STATISTICS|- Mean|- Median|- Min|- Max', case=False, na=False)]
    df = df[df['Browser_Memory_Used'] != 'ERROR']

    # Parse memory values
    def parse_memory(value):
        if pd.isna(value) or value == '':
            return None
        value_str = str(value).strip()
        if value_str.endswith(' GB'):
            return float(value_str.replace(' GB', '')) * 1024
        elif value_str.endswith(' MB'):
            return float(value_str.replace(' MB', ''))
        else:
            return float(value_str)

    df['Browser_Memory_Used'] = df['Browser_Memory_Used'].apply(parse_memory)
    df['Elapsed_Seconds'] = pd.to_numeric(df['Elapsed_Seconds'])
    df['FPS'] = pd.to_numeric(df['FPS'], errors='coerce')  # blank idle cells -> NaN
    df['CPU_Percent'] = pd.to_numeric(df['CPU_Percent'], errors='coerce')

    print(f"✅ Loaded {len(df)} data points\n")
    return df

def find_significant_spikes(df, column, threshold_type='increase'):
    """Find all significant spikes based on threshold."""
    df_copy = df.copy()
    df_copy['change'] = df_copy[column].diff()
    
    # Define thresholds based on column type
    if 'Memory' in column:
        threshold = 100  # 100 MB increase
        spikes = df_copy[df_copy['change'] > threshold]
    elif 'CPU' in column:
        threshold = 20  # 20% increase
        spikes = df_copy[df_copy['change'] > threshold]
    elif 'FPS' in column:
        threshold = -10  # 10 FPS decrease
        spikes = df_copy[df_copy['change'] < threshold]
    else:
        spikes = df_copy.nlargest(5, column)
    
    return spikes

def create_memory_page(df, pdf):
    """Page 1: Memory analysis."""
    print("📉 Creating Memory Analysis Page...")
    
    quarter_size = len(df) // 4
    first_quarter = df.iloc[:quarter_size]
    last_quarter = df.iloc[-quarter_size:]
    
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))
    fig.suptitle('🆕 Memory Performance Analysis', fontsize=16, fontweight='bold')
    
    categories = ['First 25%', 'Last 25%']
    x = np.arange(len(categories))
    width = 0.35
    
    # Memory comparison
    mem_means = [first_quarter['Browser_Memory_Used'].mean(), 
                 last_quarter['Browser_Memory_Used'].mean()]
    mem_maxs = [first_quarter['Browser_Memory_Used'].max(), 
                last_quarter['Browser_Memory_Used'].max()]
    
    axes[0].bar(x - width/2, mem_means, width, label='Mean', color='#2E86AB')
    axes[0].bar(x + width/2, mem_maxs, width, label='Max', color='#A23B72')
    axes[0].set_ylabel('Memory (MB)', fontsize=12)
    axes[0].set_title('Memory: Start vs End', fontsize=14, fontweight='bold')
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(categories)
    axes[0].legend()
    axes[0].grid(True, alpha=0.3, axis='y')
    
    mem_change = ((mem_means[1] - mem_means[0]) / mem_means[0]) * 100
    color = 'red' if mem_change > 10 else 'green' if mem_change < -10 else 'orange'
    axes[0].text(0.5, -0.15, f'Change: {mem_change:+.1f}%', 
                   transform=axes[0].transAxes, ha='center', fontsize=12,
                   bbox=dict(boxstyle='round', facecolor=color, alpha=0.3))
    
    # Memory over time with numbered markers
    axes[1].plot(df['Elapsed_Seconds'], df['Browser_Memory_Used'], 
                   label='Memory', color='#2E86AB', linewidth=2)
    
    # Find significant memory spikes
    mem_spikes = find_significant_spikes(df, 'Browser_Memory_Used')
    spike_list = []
    
    for spike_num, (idx, row) in enumerate(mem_spikes.iterrows(), 1):
        # Add numbered marker
        axes[1].plot(row['Elapsed_Seconds'], row['Browser_Memory_Used'], 
                      'ro', markersize=12, zorder=5)
        axes[1].text(row['Elapsed_Seconds'], row['Browser_Memory_Used'], 
                      str(spike_num), ha='center', va='center', 
                      fontsize=9, color='white', fontweight='bold', zorder=6)
        
        # Build reference list
        action_text = row['Action'][:50] + '...' if len(row['Action']) > 50 else row['Action']
        spike_list.append(f"  {spike_num}. {row['Elapsed_Seconds']:.0f}s: {action_text} ({row['Browser_Memory_Used']:.0f} MB)")
    
    axes[1].set_xlabel('Time (seconds)', fontsize=12)
    axes[1].set_ylabel('Memory (MB)', fontsize=12)
    title_text = f'Memory Over Time ({len(mem_spikes)} significant spikes marked)'
    axes[1].set_title(title_text, fontsize=14, fontweight='bold')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)
    
    # Add reference text box
    if spike_list:
        ref_text = "Memory Spike Events:\n" + "\n".join(spike_list)
        axes[1].text(0.02, -0.35, ref_text, transform=axes[1].transAxes,
                      fontsize=8, verticalalignment='top', family='monospace',
                      bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.7))
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    print(f"   Memory: {mem_change:+.1f}% change")

def create_cpu_page(df, pdf):
    """Page 2: CPU analysis."""
    if not df['CPU_Percent'].notna().any():
        print("   ⚠️  Skipping CPU page (no data)")
        return
        
    print("📉 Creating CPU Analysis Page...")
    
    quarter_size = len(df) // 4
    first_quarter = df.iloc[:quarter_size]
    last_quarter = df.iloc[-quarter_size:]
    
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))
    fig.suptitle('🆕 CPU Performance Analysis', fontsize=16, fontweight='bold')
    
    categories = ['First 25%', 'Last 25%']
    x = np.arange(len(categories))
    width = 0.35
    
    # CPU comparison
    cpu_means = [first_quarter['CPU_Percent'].mean(), 
                 last_quarter['CPU_Percent'].mean()]
    cpu_maxs = [first_quarter['CPU_Percent'].max(), 
                last_quarter['CPU_Percent'].max()]
    
    axes[0].bar(x - width/2, cpu_means, width, label='Mean', color='#F18F01')
    axes[0].bar(x + width/2, cpu_maxs, width, label='Max', color='#A23B72')
    axes[0].set_ylabel('CPU (%)', fontsize=12)
    axes[0].set_title('CPU: Start vs End', fontsize=14, fontweight='bold')
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(categories)
    axes[0].legend()
    axes[0].grid(True, alpha=0.3, axis='y')
    
    cpu_change = ((cpu_means[1] - cpu_means[0]) / cpu_means[0]) * 100
    color = 'red' if cpu_change > 10 else 'green' if cpu_change < -10 else 'orange'
    axes[0].text(0.5, -0.15, f'Change: {cpu_change:+.1f}%', 
                   transform=axes[0].transAxes, ha='center', fontsize=12,
                   bbox=dict(boxstyle='round', facecolor=color, alpha=0.3))
    
    # CPU over time with numbered markers
    axes[1].plot(df['Elapsed_Seconds'], df['CPU_Percent'], 
                   label='CPU', color='#F18F01', linewidth=2)
    
    # Find significant CPU spikes
    cpu_spikes = find_significant_spikes(df, 'CPU_Percent')
    cpu_spike_list = []
    
    for spike_num, (idx, row) in enumerate(cpu_spikes.iterrows(), 1):
        if pd.notna(row['CPU_Percent']):
            # Add numbered marker
            axes[1].plot(row['Elapsed_Seconds'], row['CPU_Percent'], 
                          'ro', markersize=12, zorder=5)
            axes[1].text(row['Elapsed_Seconds'], row['CPU_Percent'], 
                          str(spike_num), ha='center', va='center', 
                          fontsize=9, color='white', fontweight='bold', zorder=6)
            
            # Build reference list
            action_text = row['Action'][:50] + '...' if len(row['Action']) > 50 else row['Action']
            cpu_spike_list.append(f"  {spike_num}. {row['Elapsed_Seconds']:.0f}s: {action_text} ({row['CPU_Percent']:.0f}%)")
    
    axes[1].set_xlabel('Time (seconds)', fontsize=12)
    axes[1].set_ylabel('CPU (%)', fontsize=12)
    title_text = f'CPU Over Time ({len(cpu_spikes)} significant spikes marked)'
    axes[1].set_title(title_text, fontsize=14, fontweight='bold')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)
    
    # Add reference text box
    if cpu_spike_list:
        ref_text = "CPU Spike Events:\n" + "\n".join(cpu_spike_list)
        axes[1].text(0.02, -0.35, ref_text, transform=axes[1].transAxes,
                      fontsize=8, verticalalignment='top', family='monospace',
                      bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.7))
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    print(f"   CPU: {cpu_change:+.1f}% change")

def create_fps_page(df, pdf):
    """Page 3: FPS analysis."""
    print("📉 Creating FPS Analysis Page...")
    
    quarter_size = len(df) // 4
    first_quarter = df.iloc[:quarter_size]
    last_quarter = df.iloc[-quarter_size:]
    
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))
    fig.suptitle('🆕 FPS Performance Analysis', fontsize=16, fontweight='bold')
    
    categories = ['First 25%', 'Last 25%']
    x = np.arange(len(categories))
    width = 0.35
    
    # FPS comparison
    fps_means = [first_quarter['FPS'].mean(), last_quarter['FPS'].mean()]
    fps_mins = [first_quarter['FPS'].min(), last_quarter['FPS'].min()]
    
    axes[0].bar(x - width/2, fps_means, width, label='Mean', color='#06A77D')
    axes[0].bar(x + width/2, fps_mins, width, label='Min', color='#F18F01')
    axes[0].axhline(y=60, color='green', linestyle='--', alpha=0.5)
    axes[0].axhline(y=30, color='orange', linestyle='--', alpha=0.5)
    axes[0].set_ylabel('FPS', fontsize=12)
    axes[0].set_title('FPS: Start vs End', fontsize=14, fontweight='bold')
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(categories)
    axes[0].legend()
    axes[0].grid(True, alpha=0.3, axis='y')
    
    fps_change = ((fps_means[1] - fps_means[0]) / fps_means[0]) * 100
    color = 'green' if fps_change > 0 else 'red' if fps_change < -10 else 'orange'
    axes[0].text(0.5, -0.15, f'Change: {fps_change:+.1f}%', 
                   transform=axes[0].transAxes, ha='center', fontsize=12,
                   bbox=dict(boxstyle='round', facecolor=color, alpha=0.3))
    
    # FPS over time with numbered markers
    axes[1].plot(df['Elapsed_Seconds'], df['FPS'], 
                   label='FPS', color='#06A77D', linewidth=2)
    axes[1].axhline(y=60, color='green', linestyle='--', alpha=0.5, label='60 FPS Target')
    axes[1].axhline(y=30, color='orange', linestyle='--', alpha=0.5, label='30 FPS Min')
    
    # Find significant FPS drops
    fps_spikes = find_significant_spikes(df, 'FPS')
    fps_spike_list = []
    
    for spike_num, (idx, row) in enumerate(fps_spikes.iterrows(), 1):
        # Add numbered marker
        axes[1].plot(row['Elapsed_Seconds'], row['FPS'], 
                      'ro', markersize=12, zorder=5)
        axes[1].text(row['Elapsed_Seconds'], row['FPS'], 
                      str(spike_num), ha='center', va='center', 
                      fontsize=9, color='white', fontweight='bold', zorder=6)
        
        # Build reference list
        action_text = row['Action'][:50] + '...' if len(row['Action']) > 50 else row['Action']
        fps_spike_list.append(f"  {spike_num}. {row['Elapsed_Seconds']:.0f}s: {action_text} ({row['FPS']:.0f} FPS)")
    
    axes[1].set_xlabel('Time (seconds)', fontsize=12)
    axes[1].set_ylabel('FPS', fontsize=12)
    title_text = f'FPS Over Time ({len(fps_spikes)} significant drops marked)'
    axes[1].set_title(title_text, fontsize=14, fontweight='bold')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)
    
    # Add reference text box
    if fps_spike_list:
        ref_text = "FPS Drop Events:\n" + "\n".join(fps_spike_list)
        axes[1].text(0.02, -0.35, ref_text, transform=axes[1].transAxes,
                      fontsize=8, verticalalignment='top', family='monospace',
                      bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.7))
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    print(f"   FPS: {fps_change:+.1f}% change")

def create_action_breakdown(df, pdf):
    """Page 4: Action-based performance breakdown."""
    print("📋 Creating Action-Based Performance Breakdown...")
    
    df_copy = df.copy()
    df_copy['Category'] = df_copy['Action'].apply(lambda x: 
        'Panning/Zooming' if any(w in str(x).lower() for w in ['zoom', 'panning', 'viewing', 'manual zoom']) else
        'Map Projection' if any(w in str(x).lower() for w in ['set to globe', 'set to mercator']) else
        'Layer Config' if any(w in str(x).lower() for w in ['enabled', 'layer', 'airport', 'satellite', 'tfr', 'fir', 'radar', 'pirep', 'edr', 'vaac', 'conditions', 'shown', 'type:']) else
        'Other'
    )
    
    # Exclude Setup and Other categories
    categories = [c for c in df_copy['Category'].unique() if c not in ['Other']]
    
    fig, axes = plt.subplots(3, 1, figsize=(14, 12))
    fig.suptitle('🆕 Performance by Action Type', fontsize=16, fontweight='bold')
    
    # Memory box plot
    mem_data = [df_copy[df_copy['Category'] == cat]['Browser_Memory_Used'].dropna() 
                for cat in categories]
    bp_mem = axes[0].boxplot(mem_data, tick_labels=categories, patch_artist=True)
    for patch in bp_mem['boxes']:
        patch.set_facecolor('#2E86AB')
        patch.set_alpha(0.6)
    axes[0].set_ylabel('Memory (MB)', fontsize=12)
    axes[0].set_title('Memory Usage by Action Type', fontsize=14, fontweight='bold')
    axes[0].grid(True, alpha=0.3, axis='y')
    axes[0].tick_params(axis='x', rotation=45)
    
    # CPU box plot
    if df['CPU_Percent'].notna().any():
        cpu_data = [df_copy[df_copy['Category'] == cat]['CPU_Percent'].dropna() 
                    for cat in categories]
        bp_cpu = axes[1].boxplot(cpu_data, tick_labels=categories, patch_artist=True)
        for patch in bp_cpu['boxes']:
            patch.set_facecolor('#F18F01')
            patch.set_alpha(0.6)
        axes[1].set_ylabel('CPU (%)', fontsize=12)
        axes[1].set_title('CPU Usage by Action Type', fontsize=14, fontweight='bold')
        axes[1].grid(True, alpha=0.3, axis='y')
        axes[1].tick_params(axis='x', rotation=45)
    else:
        axes[1].text(0.5, 0.5, 'No CPU data', ha='center', va='center', 
                     transform=axes[1].transAxes, fontsize=14)
    
    # FPS box plot
    fps_data = [df_copy[df_copy['Category'] == cat]['FPS'].dropna() 
                for cat in categories]
    bp_fps = axes[2].boxplot(fps_data, tick_labels=categories, patch_artist=True)
    for patch in bp_fps['boxes']:
        patch.set_facecolor('#06A77D')
        patch.set_alpha(0.6)
    axes[2].axhline(y=60, color='green', linestyle='--', alpha=0.5)
    axes[2].axhline(y=30, color='orange', linestyle='--', alpha=0.5)
    axes[2].set_ylabel('FPS', fontsize=12)
    axes[2].set_title('FPS by Action Type', fontsize=14, fontweight='bold')
    axes[2].grid(True, alpha=0.3, axis='y')
    axes[2].tick_params(axis='x', rotation=45)
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    print("   ✓ Box plots created\n")

def create_memory_growth_rate(df, pdf):
    """Page 4: Cumulative memory growth analysis."""
    print("📈 Creating Cumulative Memory Growth Analysis...")
    
    # Calculate cumulative growth from baseline
    baseline_memory = df['Browser_Memory_Used'].iloc[0]
    df_copy = df.copy()
    df_copy['Cumulative_Growth'] = df_copy['Browser_Memory_Used'] - baseline_memory
    df_copy['Growth_Change'] = df_copy['Cumulative_Growth'].diff()
    
    # Calculate total growth
    total_growth = df_copy['Cumulative_Growth'].iloc[-1]
    percent_growth = (total_growth / baseline_memory) * 100
    
    fig, ax = plt.subplots(1, 1, figsize=(14, 10))
    fig.suptitle('🆕 Cumulative Memory Growth Analysis', fontsize=16, fontweight='bold')
    
    # Plot cumulative growth
    ax.plot(df_copy['Elapsed_Seconds'], df_copy['Cumulative_Growth'], 
            color='#2E86AB', linewidth=3, label='Memory Growth from Baseline')
    
    # Fill area under the curve for better visualization
    ax.fill_between(df_copy['Elapsed_Seconds'], 0, df_copy['Cumulative_Growth'], 
                     alpha=0.2, color='#2E86AB')
    
    # Find significant growth spikes (large increases in cumulative growth)
    threshold = 100  # 100 MB increase in growth
    growth_spikes = df_copy[df_copy['Growth_Change'] > threshold]
    spike_list = []
    
    for spike_num, (idx, row) in enumerate(growth_spikes.iterrows(), 1):
        # Add numbered marker
        ax.plot(row['Elapsed_Seconds'], row['Cumulative_Growth'], 
                'ro', markersize=12, zorder=5)
        ax.text(row['Elapsed_Seconds'], row['Cumulative_Growth'], 
                str(spike_num), ha='center', va='center', 
                fontsize=9, color='white', fontweight='bold', zorder=6)
        
        # Build reference list
        action_text = row['Action'][:50] + '...' if len(row['Action']) > 50 else row['Action']
        spike_list.append(f"  {spike_num}. {row['Elapsed_Seconds']:.0f}s: {action_text} (+{row['Growth_Change']:.0f} MB)")
    
    # Add baseline reference
    ax.axhline(y=0, color='black', linestyle='--', linewidth=1.5, alpha=0.7, 
               label=f'Baseline: {baseline_memory:.0f} MB')
    
    # Styling
    ax.set_xlabel('Time (seconds)', fontsize=14, fontweight='bold')
    ax.set_ylabel('Memory Growth (MB)', fontsize=14, fontweight='bold')
    title_text = f'Total Memory Accumulated Since Test Start ({len(growth_spikes)} significant growth events marked)'
    ax.set_title(title_text, fontsize=14, fontweight='bold')
    ax.legend(loc='upper left', fontsize=11)
    ax.grid(True, alpha=0.3)
    
    # Add reference text box for growth spikes AND summary (side by side below graph)
    if spike_list:
        # Left side: Growth events
        ref_text = "Significant Growth Events:\n" + "\n".join(spike_list)
        ax.text(0.02, -0.25, ref_text, transform=ax.transAxes,
                fontsize=9, verticalalignment='top', family='monospace',
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.7))
        
        # Right side: Summary
        summary_text = f"""
MEMORY GROWTH SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Starting Memory:  {baseline_memory:.1f} MB
Ending Memory:    {df['Browser_Memory_Used'].iloc[-1]:.1f} MB
Total Growth:     +{total_growth:.1f} MB
Percent Increase: +{percent_growth:.1f}%
Test Duration:    {df['Elapsed_Seconds'].iloc[-1]:.0f} seconds
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        """
        
        ax.text(0.98, -0.25, summary_text.strip(), transform=ax.transAxes,
                fontsize=10, verticalalignment='top', horizontalalignment='right',
                family='monospace', bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.7))
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    
    print(f"   Starting memory: {baseline_memory:.1f} MB")
    print(f"   Ending memory: {df['Browser_Memory_Used'].iloc[-1]:.1f} MB")
    print(f"   Total growth: +{total_growth:.1f} MB (+{percent_growth:.1f}%)")
    print(f"   Growth spikes: {len(growth_spikes)} events marked")
    print(f"   Test duration: {df['Elapsed_Seconds'].iloc[-1]:.0f} seconds\n")

def load_data_with_phases(csv_file):
    """Load and clean CSV data, preserving phase markers."""
    print(f"📊 Loading data from {csv_file}...")

    df = _read_metrics_csv(csv_file)
    
    # Store phase markers BEFORE cleaning
    phase_markers = df[df['Action'].str.contains('PHASE.*STATISTICS', case=False, na=False)].copy()
    
    # Remove statistics rows
    df = df[~df['Action'].str.contains(r'STATISTICS|- Mean|- Median|- Min|- Max', case=False, na=False)]
    df = df[df['Browser_Memory_Used'] != 'ERROR']
    
    # Parse memory values
    def parse_memory(value):
        if pd.isna(value) or value == '':
            return None
        value_str = str(value).strip()
        if value_str.endswith(' GB'):
            return float(value_str.replace(' GB', '')) * 1024
        elif value_str.endswith(' MB'):
            return float(value_str.replace(' MB', ''))
        else:
            return float(value_str)
    
    df['Browser_Memory_Used'] = df['Browser_Memory_Used'].apply(parse_memory)
    df['Elapsed_Seconds'] = pd.to_numeric(df['Elapsed_Seconds'])
    df['FPS'] = pd.to_numeric(df['FPS'], errors='coerce')  # blank idle cells -> NaN
    df['CPU_Percent'] = pd.to_numeric(df['CPU_Percent'], errors='coerce')
    
    # Also convert phase markers elapsed seconds
    if len(phase_markers) > 0:
        phase_markers['Elapsed_Seconds'] = pd.to_numeric(phase_markers['Elapsed_Seconds'])
    
    print(f"✅ Loaded {len(df)} data points")
    if len(phase_markers) > 0:
        print(f"✅ Found {len(phase_markers)} phase markers\n")
    else:
        print("⚠️  No phase markers found (single-phase test)\n")
    
    return df, phase_markers

def _phase_key(action):
    """The phase identifier = the marker text before ' STATISTICS'.

    e.g. 'Phase 1: Globe/Satellite STATISTICS (58 samples)' -> 'Phase 1: Globe/Satellite'.
    Used as a stable dict key shared by extract_phases() and phase_label_map().
    """
    return re.sub(r'\s*STATISTICS.*$', '', str(action), flags=re.IGNORECASE).strip()

def extract_phases(df, phase_markers):
    """Extract each phase's data segment, generic to whatever markers exist.

    Works regardless of the marker numbering (old 'PHASE 2–5' or new 'Phase 1–4')
    by segmenting the timeline between consecutive phase-statistics markers.
    """
    phases = {}
    if phase_markers is None or len(phase_markers) == 0:
        return phases

    pm = phase_markers.sort_values('Elapsed_Seconds')
    prev_end = 0
    for _, marker in pm.iterrows():
        key = _phase_key(marker['Action'])
        phase_end_time = float(marker['Elapsed_Seconds'])

        phase_data = df[(df['Elapsed_Seconds'] > prev_end) & (df['Elapsed_Seconds'] <= phase_end_time)].copy()
        # Filter out rows with NaN values in critical columns for plotting
        phase_data = phase_data.dropna(subset=['Elapsed_Seconds', 'Browser_Memory_Used', 'FPS'])

        if len(phase_data) > 0:
            min_seconds = phase_data['Elapsed_Seconds'].min()
            phase_data['Phase_Seconds'] = phase_data['Elapsed_Seconds'] - min_seconds
            phases[key] = phase_data

        prev_end = phase_end_time

    return phases

def phase_label_map(phase_markers):
    """Map each phase key -> a display label numbered 1..N in run order.

    Phase markers look like 'Phase 1: Globe/Satellite STATISTICS (58 samples)'.
    We renumber sequentially starting at 1, in the order phases actually ran, and
    keep the 'Globe/Satellite' projection/style descriptor. Robust to older CSVs
    that numbered the markers 'PHASE 2–5'.
    """
    labels = {}
    if phase_markers is None or len(phase_markers) == 0:
        return labels

    pm = phase_markers.copy()
    if 'Elapsed_Seconds' in pm.columns:
        pm = pm.sort_values('Elapsed_Seconds')  # display order = chronological
    seq = 0
    for _, row in pm.iterrows():
        key = _phase_key(row['Action'])
        seq += 1
        m = re.match(r'(?:PHASE)\s*\d+\s*:?\s*(.*)$', key, re.IGNORECASE)
        desc = m.group(1).strip() if m else key
        desc_fmt = ' / '.join(p.strip() for p in desc.split('/') if p.strip())
        labels[key] = f'Phase {seq}: {desc_fmt}' if desc_fmt else f'Phase {seq}'
    return labels

def create_phase_comparison(df, phase_markers, pdf):
    """Create side-by-side comparison of each phase."""
    if len(phase_markers) == 0:
        print("⚠️  Skipping phase comparison (no phase markers)")
        return
    
    print(f"📊 Creating phase comparison...")
    
    phases = extract_phases(df, phase_markers)
    
    if not phases:
        print("⚠️  No phases detected")
        return
    
    num_phases = len(phases)
    print(f"   Found {num_phases} phases to plot: {list(phases.keys())}")
    
    # Increase figure width for 4 phases to prevent cutoff
    fig_width = 7 * num_phases if num_phases >= 4 else 6 * num_phases
    fig, axes = plt.subplots(3, num_phases, figsize=(fig_width, 12))
    fig.suptitle('Phase-by-Phase Performance Comparison', fontsize=16, fontweight='bold')
    
    phase_list = list(phases.items())
    labels = phase_label_map(phase_markers)
    print(f"   Plotting {len(phase_list)} phase columns...")

    for col, (phase_name, phase_df) in enumerate(phase_list):
        display_label = labels.get(phase_name, phase_name)
        ax_mem = axes[0, col] if num_phases > 1 else axes[0]
        ax_mem.plot(phase_df['Phase_Seconds'], phase_df['Browser_Memory_Used'],
                   label='Memory', color='#2E86AB', linewidth=2)
        ax_mem.set_title(display_label, fontsize=12, fontweight='bold')
        ax_mem.set_ylabel('Memory (MB)', fontsize=10)
        ax_mem.legend(loc='upper left', fontsize=8)
        ax_mem.grid(True, alpha=0.3)
        
        ax_cpu = axes[1, col] if num_phases > 1 else axes[1]
        if phase_df['CPU_Percent'].notna().any():
            ax_cpu.plot(phase_df['Phase_Seconds'], phase_df['CPU_Percent'], 
                       color='#F18F01', linewidth=2)
            ax_cpu.set_ylabel('CPU (%)', fontsize=10)
            ax_cpu.grid(True, alpha=0.3)
        else:
            ax_cpu.text(0.5, 0.5, 'No CPU data', ha='center', va='center', transform=ax_cpu.transAxes)
        
        ax_fps = axes[2, col] if num_phases > 1 else axes[2]
        ax_fps.plot(phase_df['Phase_Seconds'], phase_df['FPS'], color='#06A77D', linewidth=2)
        ax_fps.axhline(y=60, color='green', linestyle='--', alpha=0.5)
        ax_fps.axhline(y=30, color='orange', linestyle='--', alpha=0.5)
        ax_fps.set_xlabel('Time (seconds)', fontsize=10)
        ax_fps.set_ylabel('FPS', fontsize=10)
        ax_fps.grid(True, alpha=0.3)
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    
    # Print statistics
    print("\n" + "="*60)
    print("📊 PHASE STATISTICS")
    print("="*60)
    for phase_name, phase_df in phases.items():
        print(f"\n{labels.get(phase_name, phase_name)}:")
        print(f"  Memory: {phase_df['Browser_Memory_Used'].mean():.1f} MB (avg), {phase_df['Browser_Memory_Used'].max():.1f} MB (max)")
        if phase_df['CPU_Percent'].notna().any():
            print(f"  CPU:    {phase_df['CPU_Percent'].mean():.1f}% (avg), {phase_df['CPU_Percent'].max():.1f}% (max)")
        _afps = active_fps(phase_df)
        print(f"  FPS:    {_afps.mean():.0f} (avg), {_afps.min():.0f} (min)  [active-movement only]" if len(_afps) else "  FPS:    n/a (no active-movement samples)")
    print("="*60 + "\n")

def create_phase_overlay(df, phase_markers, pdf):
    """Create overlay comparison of all phases."""
    if len(phase_markers) == 0:
        return
    
    print(f"📊 Creating phase overlay...")
    
    phases = extract_phases(df, phase_markers)
    if not phases:
        return
    
    fig, axes = plt.subplots(3, 1, figsize=(14, 12))
    fig.suptitle('Phase Overlay Comparison', fontsize=16, fontweight='bold')
    
    colors = ['#2E86AB', '#F18F01', '#06A77D', '#A23B72']
    labels = phase_label_map(phase_markers)

    for i, (phase_name, phase_df) in enumerate(phases.items()):
        color = colors[i % len(colors)]
        display_label = labels.get(phase_name, phase_name)

        axes[0].plot(phase_df['Phase_Seconds'], phase_df['Browser_Memory_Used'],
                    label=display_label, color=color, linewidth=2)

        if phase_df['CPU_Percent'].notna().any():
            axes[1].plot(phase_df['Phase_Seconds'], phase_df['CPU_Percent'],
                        label=display_label, color=color, linewidth=2)

        axes[2].plot(phase_df['Phase_Seconds'], phase_df['FPS'],
                    label=display_label, color=color, linewidth=2)
    
    axes[0].set_ylabel('Memory (MB)', fontsize=12)
    axes[0].set_title('Memory by Phase', fontsize=14, fontweight='bold')
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)
    
    axes[1].set_ylabel('CPU (%)', fontsize=12)
    axes[1].set_title('CPU by Phase', fontsize=14, fontweight='bold')
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)
    
    axes[2].set_xlabel('Time (seconds)', fontsize=12)
    axes[2].set_ylabel('FPS', fontsize=12)
    axes[2].set_title('FPS by Phase', fontsize=14, fontweight='bold')
    axes[2].axhline(y=60, color='green', linestyle='--', alpha=0.5)
    axes[2].axhline(y=30, color='orange', linestyle='--', alpha=0.5)
    axes[2].legend()
    axes[2].grid(True, alpha=0.3)
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)

def create_combined_timeline(df, pdf):
    """Create combined timeline of all metrics."""
    print(f"📊 Creating combined timeline...")
    
    fig, axes = plt.subplots(3, 1, figsize=(14, 12))
    fig.suptitle('Combined Performance Timeline', fontsize=16, fontweight='bold')
    
    axes[0].plot(df['Elapsed_Seconds'], df['Browser_Memory_Used'], 
                color='#2E86AB', linewidth=2)
    axes[0].set_ylabel('Memory (MB)', fontsize=12)
    axes[0].set_title('Memory Over Time', fontsize=14, fontweight='bold')
    axes[0].grid(True, alpha=0.3)
    
    if df['CPU_Percent'].notna().any():
        axes[1].plot(df['Elapsed_Seconds'], df['CPU_Percent'], 
                    color='#F18F01', linewidth=2)
        axes[1].set_ylabel('CPU (%)', fontsize=12)
        axes[1].set_title('CPU Over Time', fontsize=14, fontweight='bold')
        axes[1].grid(True, alpha=0.3)
    else:
        axes[1].text(0.5, 0.5, 'No CPU data', ha='center', va='center', transform=axes[1].transAxes)
    
    axes[2].plot(df['Elapsed_Seconds'], df['FPS'], 
                color='#06A77D', linewidth=2)
    axes[2].axhline(y=60, color='green', linestyle='--', alpha=0.5)
    axes[2].axhline(y=30, color='orange', linestyle='--', alpha=0.5)
    axes[2].set_xlabel('Time (seconds)', fontsize=12)
    axes[2].set_ylabel('FPS', fontsize=12)
    axes[2].set_title('FPS Over Time', fontsize=14, fontweight='bold')
    axes[2].grid(True, alpha=0.3)
    
    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)

def create_timebar_page(df, pdf):
    """Dedicated page for the Timebar segment.

    The Timebar runs the map STATIC while forecast frames animate, so it's a
    distinct load profile from pan/zoom. Its samples still feed the overall
    metrics on the summary page; this page isolates just the Timebar rows so its
    memory/CPU/FPS can be read on their own. Returns True if the page was drawn.
    """
    tb = df[df['Action'].str.contains('Timebar playback', case=False, na=False)].copy()
    if len(tb) == 0:
        return False  # no timebar segment in this run — skip the page

    print("🛰️  Creating Timebar Segment Analysis Page...")

    # Re-zero the x-axis to the start of the timebar segment for readability.
    t0 = tb['Elapsed_Seconds'].min()
    tb['Seg_Seconds'] = tb['Elapsed_Seconds'] - t0

    mem = tb['Browser_Memory_Used'].dropna()
    cpu = tb['CPU_Percent'].dropna()
    fps = tb['FPS'].dropna()

    fig, axes = plt.subplots(3, 1, figsize=(14, 12))
    fig.suptitle('🛰️  Timebar Segment — Static Map, Animating Forecast',
                 fontsize=16, fontweight='bold')

    # Memory
    axes[0].plot(tb['Seg_Seconds'], tb['Browser_Memory_Used'], color='#2E86AB', linewidth=2)
    axes[0].set_ylabel('Memory (MB)', fontsize=12)
    mem_title = 'Memory Over Time (Timebar)'
    if len(mem) > 0:
        mem_title += f'  —  mean {mem.mean():.0f} MB · peak {mem.max():.0f} MB'
    axes[0].set_title(mem_title, fontsize=13, fontweight='bold')
    axes[0].grid(True, alpha=0.3)

    # CPU
    if len(cpu) > 0:
        axes[1].plot(tb['Seg_Seconds'], tb['CPU_Percent'], color='#F18F01', linewidth=2)
        axes[1].set_title(f'CPU Over Time (Timebar)  —  mean {cpu.mean():.1f}% · peak {cpu.max():.1f}%',
                          fontsize=13, fontweight='bold')
    else:
        axes[1].text(0.5, 0.5, 'No CPU data', ha='center', va='center', transform=axes[1].transAxes)
        axes[1].set_title('CPU Over Time (Timebar)', fontsize=13, fontweight='bold')
    axes[1].set_ylabel('CPU (%)', fontsize=12)
    axes[1].grid(True, alpha=0.3)

    # FPS — the headline metric: how well the renderer keeps up with the animation
    axes[2].plot(tb['Seg_Seconds'], tb['FPS'], color='#06A77D', linewidth=2)
    axes[2].axhline(y=60, color='green', linestyle='--', alpha=0.5)
    axes[2].axhline(y=30, color='orange', linestyle='--', alpha=0.5)
    axes[2].set_xlabel('Seconds into Timebar segment', fontsize=12)
    axes[2].set_ylabel('FPS', fontsize=12)
    fps_title = 'FPS Over Time (Timebar)'
    if len(fps) > 0:
        fps_title += f'  —  mean {fps.mean():.0f} · min {fps.min():.0f}'
    axes[2].set_title(fps_title, fontsize=13, fontweight='bold')
    axes[2].grid(True, alpha=0.3)

    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    return True

def load_errors(errors_file):
    """Load the parallel console-errors CSV, if it exists."""
    if not os.path.exists(errors_file):
        return pd.DataFrame()
    try:
        df = pd.read_csv(errors_file, quotechar='"', escapechar='\\')
        if df.empty:
            return df
        df['Elapsed_Seconds'] = pd.to_numeric(df['Elapsed_Seconds'], errors='coerce')
        df = df.dropna(subset=['Elapsed_Seconds']).reset_index(drop=True)
        print(f"⚠️  Loaded {len(df)} console error(s) from {os.path.basename(errors_file)}")
        return df
    except Exception as e:
        print(f"⚠️  Could not load errors file ({errors_file}): {e}")
        return pd.DataFrame()


def _short_call(url):
    """Normalize a full URL to its API path (host + query stripped) for grouping."""
    if not url or str(url).lower() == 'nan':
        return '(no url)'
    try:
        path = urlparse(str(url)).path or str(url)
    except Exception:
        path = str(url)
    return path if path else '(root)'


def _status_code(row):
    """Pull an HTTP status code (3-digit, 400-599) from Message, else label by Type."""
    msg = str(row.get('Message', ''))
    for m in re.findall(r'\b([45]\d\d)\b', msg):
        return m
    t = str(row.get('Type', ''))
    if t == 'requestfailed':
        return 'failed'
    if t == 'pageerror':
        return 'pageerror'
    return 'other'


def create_errors_frequency_page(errors_df, pdf):
    """Console errors by frequency: one bar per unique (type + status code +
    endpoint), height = how many times it occurred. Bars colored by error type."""
    print("⚠️  Creating Console Errors by Frequency page...")

    fig, ax = plt.subplots(figsize=(22, 12))
    fig.suptitle('Console Errors by Frequency', fontsize=16, fontweight='bold')

    if errors_df is None or len(errors_df) == 0:
        ax.text(0.5, 0.5, 'No console errors captured during this test',
                ha='center', va='center', fontsize=18, fontweight='bold', color='green',
                transform=ax.transAxes)
        ax.axis('off')
        pdf.savefig(fig, bbox_inches='tight'); plt.close(fig)
        print("   ✓ No errors to chart"); return

    type_colors = {
        'pageerror': '#A23B72', 'console.error': '#F18F01',
        'http_4xx': '#2E86AB', 'http_5xx': '#C73E1D', 'requestfailed': '#6B4F8F',
    }

    d = errors_df.copy()
    d['Call'] = d['URL'].apply(_short_call)
    d['Code'] = d.apply(_status_code, axis=1)
    grouped = (d.groupby(['Type', 'Code', 'Call'], dropna=False)
               .size().reset_index(name='count')
               .sort_values('count', ascending=False))

    max_bars = 20
    shown = grouped.head(max_bars)

    def short_call(call):
        c = str(call)
        return c if len(c) <= 32 else '…' + c[-29:]

    labels = [f"{r.Code} · {short_call(r.Call)}" for r in shown.itertuples()]
    colors = [type_colors.get(t, '#2E86AB') for t in shown['Type']]
    x = range(len(shown))

    bars = ax.bar(x, shown['count'], color=colors, edgecolor='black', linewidth=0.6)
    for rect, c in zip(bars, shown['count']):
        ax.text(rect.get_x() + rect.get_width() / 2, c, str(int(c)),
                ha='center', va='bottom', fontsize=9, fontweight='bold')

    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, rotation=40, ha='right', fontsize=9, family='monospace')
    ax.set_ylabel('Number of errors', fontsize=13)
    ax.set_xlabel('Console error  (status code · endpoint)', fontsize=13)
    ax.set_title(f'{len(grouped)} unique errors • {int(grouped["count"].sum())} total events',
                 fontsize=12)
    ax.grid(True, alpha=0.3, axis='y')

    handles = [Patch(facecolor=type_colors.get(t, '#2E86AB'), edgecolor='black', label=t)
               for t in shown['Type'].unique()]
    ax.legend(handles=handles, title='Error type', loc='upper right', fontsize=10)

    if len(grouped) > max_bars:
        ax.text(0.99, -0.32, f'Showing top {max_bars} of {len(grouped)} unique errors — see the console_errors CSV for the rest',
                transform=ax.transAxes, ha='right', va='top', fontsize=9, style='italic', color='#666')

    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight'); plt.close(fig)
    print(f"   ✓ Charted {len(grouped)} unique error(s) by frequency")


def create_fps_by_interaction_page(df, phase_markers, pdf):
    """FPS broken out by interaction type — pan-only vs zoom-only vs mixed —
    per phase when phases exist. Uses the Action labels the test writes for the
    isolated segments ("Pan only (L/R)" / "Zoom only (in/out)" / "Panning and
    zooming"). Lets you see which interaction is hardest on frame rate."""
    print("📊 Creating FPS by Interaction Type page...")

    ACTIVITIES = [
        ('Pan only (L/R)', 'Pan only', '#2E86AB'),
        ('Zoom only (in/out)', 'Zoom only', '#F18F01'),
        ('Panning and zooming', 'Mixed', '#6B4F8F'),
    ]

    # One group per phase if phases exist, else a single "Overall" group.
    if phase_markers is not None and len(phase_markers) > 0:
        labels = phase_label_map(phase_markers)
        phases = extract_phases(df, phase_markers)
        groups = [(labels.get(k, k), frame) for k, frame in phases.items()]
    else:
        groups = [('Overall', df)]

    def avg_fps(frame, action_label):
        sub = frame[frame['Action'].astype(str) == action_label]
        vals = pd.to_numeric(sub['FPS'], errors='coerce').dropna()
        return vals.mean() if len(vals) else None

    fig, (ax, ax_tbl) = plt.subplots(2, 1, figsize=(16, 11), gridspec_kw={'height_ratios': [2, 1]})
    fig.suptitle('FPS by Interaction Type', fontsize=16, fontweight='bold')

    n_groups, n_act = len(groups), len(ACTIVITIES)
    bar_w = 0.8 / n_act
    x = np.arange(n_groups)
    any_data = False
    for ai, (action_label, disp, color) in enumerate(ACTIVITIES):
        vals = [avg_fps(frame, action_label) for _, frame in groups]
        if any(v is not None for v in vals):
            any_data = True
        positions = x + (ai - (n_act - 1) / 2) * bar_w
        ax.bar(positions, [v if v is not None else 0 for v in vals], bar_w,
               label=disp, color=color, edgecolor='black', linewidth=0.5)
        for pos, v in zip(positions, vals):
            if v is not None:
                ax.text(pos, v, f'{v:.0f}', ha='center', va='bottom', fontsize=9, fontweight='bold')

    ax.set_xticks(x)
    ax.set_xticklabels([g for g, _ in groups], fontsize=10)
    ax.set_ylabel('Average FPS', fontsize=12)
    ax.axhline(y=60, color='green', linestyle='--', alpha=0.5)
    ax.axhline(y=30, color='orange', linestyle='--', alpha=0.5)
    ax.set_title('Average FPS per interaction type' + (' (by phase)' if n_groups > 1 else ''),
                 fontsize=12)
    ax.legend(loc='upper right', fontsize=10)
    ax.grid(True, alpha=0.3, axis='y')

    # Table of the same numbers
    ax_tbl.axis('off')
    col_labels = ['Phase'] + [disp for _, disp, _ in ACTIVITIES]
    rows = []
    for gname, frame in groups:
        row = [gname]
        for action_label, _disp, _c in ACTIVITIES:
            v = avg_fps(frame, action_label)
            row.append(f'{v:.0f}' if v is not None else '—')
        rows.append(row)
    table = ax_tbl.table(cellText=rows, colLabels=col_labels, cellLoc='center', bbox=[0, 0, 1, 0.9])
    table.auto_set_font_size(False); table.set_fontsize(11)
    for c in range(len(col_labels)):
        cell = table[0, c]; cell.set_facecolor('#2E86AB'); cell.set_text_props(color='white', fontweight='bold')

    if not any_data:
        ax.text(0.5, 0.5, 'No isolated pan/zoom segments in this run\n(run a test with the updated script to populate this)',
                ha='center', va='center', transform=ax.transAxes, fontsize=12, style='italic', color='#666')

    plt.tight_layout()
    pdf.savefig(fig, bbox_inches='tight'); plt.close(fig)
    print("   ✓ FPS-by-interaction page created")


def create_summary_page(df, phase_markers, errors_df, total_duration, pdf):
    """Page 1: one-glance executive summary — KPIs, a health check, and a
    per-phase table. Designed so a reader can stop after this page."""
    print("📋 Creating Executive Summary page...")

    n = len(df)
    q = max(1, n // 4)
    mem = df['Browser_Memory_Used'].dropna()
    start_mem = df['Browser_Memory_Used'].head(q).mean()
    end_mem = df['Browser_Memory_Used'].tail(q).mean()
    peak_mem = mem.max() if len(mem) else 0
    growth = (end_mem - start_mem) if (pd.notna(start_mem) and pd.notna(end_mem)) else 0
    growth_pct = (growth / start_mem * 100) if start_mem else 0
    cpu = df['CPU_Percent'].dropna()
    cpu_avg, cpu_max = (cpu.mean(), cpu.max()) if len(cpu) else (float('nan'), float('nan'))
    fps = active_fps(df)  # active-movement samples only; idle holds excluded
    fps_avg, fps_min = (fps.mean(), fps.min()) if len(fps) else (float('nan'), float('nan'))
    n_errors = 0 if errors_df is None else len(errors_df)
    labels = phase_label_map(phase_markers)
    phases = extract_phases(df, phase_markers)
    dur_m, dur_s = int(total_duration // 60), int(total_duration % 60)

    GREEN, ORANGE, RED, BLUE = '#1B7837', '#E08214', '#C73E1D', '#2E86AB'
    mem_color = RED if growth_pct > 20 else ORANGE if growth_pct > 5 else GREEN
    fps_color = RED if (pd.notna(fps_min) and fps_min < 30) else ORANGE if (pd.notna(fps_avg) and fps_avg < 50) else GREEN
    cpu_color = RED if (pd.notna(cpu_max) and cpu_max > 90) else ORANGE if (pd.notna(cpu_max) and cpu_max > 75) else GREEN
    err_color = GREEN if n_errors == 0 else ORANGE if n_errors < 20 else RED

    fig = plt.figure(figsize=(22, 14))
    fig.suptitle('Performance Test — Executive Summary', fontsize=20, fontweight='bold', y=0.98)
    gs = fig.add_gridspec(3, 1, height_ratios=[1.0, 0.8, 1.5], hspace=0.25)

    # ---- KPI cards ----
    ax_kpi = fig.add_subplot(gs[0]); ax_kpi.axis('off')
    cards = [
        (f'{dur_m}m {dur_s}s', 'Test Duration', BLUE),
        (f'{growth:+.0f} MB\n({growth_pct:+.0f}%)', 'Memory Growth', mem_color),
        (f'{peak_mem:.0f} MB', 'Peak Memory', BLUE),
        (f'{cpu_avg:.0f}%' if pd.notna(cpu_avg) else 'n/a', 'Avg CPU', cpu_color),
        (f'{fps_avg:.0f}' if pd.notna(fps_avg) else 'n/a', 'Avg FPS', fps_color),
        (f'{n_errors}', 'Console Errors', err_color),
    ]
    m, gap = 0.02, 0.015
    w = (1 - 2 * m - (len(cards) - 1) * gap) / len(cards)
    for i, (val, lab, col) in enumerate(cards):
        x = m + i * (w + gap)
        ax_kpi.add_patch(Rectangle((x, 0.12), w, 0.76, transform=ax_kpi.transAxes,
                                   facecolor=col, alpha=0.13, edgecolor=col, linewidth=2.2))
        ax_kpi.text(x + w / 2, 0.60, val, ha='center', va='center', transform=ax_kpi.transAxes,
                    fontsize=21, fontweight='bold', color=col)
        ax_kpi.text(x + w / 2, 0.24, lab, ha='center', va='center', transform=ax_kpi.transAxes,
                    fontsize=12, color='#333')

    # ---- Health check ----
    ax_h = fig.add_subplot(gs[1]); ax_h.axis('off')
    def verdict(color, ok, warn, bad):
        return ok if color == GREEN else warn if color == ORANGE else bad
    fps_txt = (f"FPS: {verdict(fps_color, 'smooth', 'occasionally low', 'dropped below 30')} — avg {fps_avg:.0f}, min {fps_min:.0f}"
               if pd.notna(fps_avg) else "FPS: no data")
    cpu_txt = (f"CPU: {verdict(cpu_color, 'healthy', 'elevated', 'sustained high')} — avg {cpu_avg:.0f}%, peak {cpu_max:.0f}%"
               if pd.notna(cpu_avg) else "CPU: no data")
    lines = [
        (mem_color, f"Memory: {verdict(mem_color, 'stable', 'mild growth', 'possible leak')} — {start_mem:.0f}→{end_mem:.0f} MB ({growth_pct:+.0f}%), peak {peak_mem:.0f} MB"),
        (fps_color if pd.notna(fps_avg) else BLUE, fps_txt),
        (cpu_color if pd.notna(cpu_avg) else BLUE, cpu_txt),
        (err_color, f"Console errors: {'none captured' if n_errors == 0 else str(n_errors) + ' captured after login'}"),
    ]
    ax_h.text(0.02, 0.95, 'Health Check', transform=ax_h.transAxes, fontsize=14, fontweight='bold', va='top')
    y = 0.72
    for color, txt in lines:
        ax_h.text(0.03, y, '●', transform=ax_h.transAxes, fontsize=13, fontweight='bold', va='top', color=color)
        ax_h.text(0.055, y, txt, transform=ax_h.transAxes, fontsize=12, va='top', color='#222')
        y -= 0.22

    # ---- Per-phase table ----
    ax_t = fig.add_subplot(gs[2]); ax_t.axis('off')
    col_labels = ['Segment', 'Mem avg', 'Mem peak', 'CPU avg', 'FPS avg', 'FPS min']
    rows = []
    for key, pdat in phases.items():
        rows.append([
            labels.get(key, key),
            f"{pdat['Browser_Memory_Used'].mean():.0f} MB",
            f"{pdat['Browser_Memory_Used'].max():.0f} MB",
            f"{pdat['CPU_Percent'].mean():.0f}%" if pdat['CPU_Percent'].notna().any() else 'n/a',
            f"{active_fps(pdat).mean():.0f}" if len(active_fps(pdat)) else 'n/a',
            f"{active_fps(pdat).min():.0f}" if len(active_fps(pdat)) else 'n/a',
        ])
    # The Timebar segment isn't a "phase" (no phase-stats marker, and it runs after
    # the last one), so extract_phases misses it. Add it as its own row so the
    # summary table compiles ALL segments, including the Timebar.
    tb = df[df['Action'].str.contains('Timebar playback', case=False, na=False)]
    if len(tb) > 0:
        tb_fps = active_fps(tb)
        rows.append([
            'Timebar (static)',
            f"{tb['Browser_Memory_Used'].mean():.0f} MB",
            f"{tb['Browser_Memory_Used'].max():.0f} MB",
            f"{tb['CPU_Percent'].mean():.0f}%" if tb['CPU_Percent'].notna().any() else 'n/a',
            f"{tb_fps.mean():.0f}" if len(tb_fps) else 'n/a',
            f"{tb_fps.min():.0f}" if len(tb_fps) else 'n/a',
        ])
    if rows:
        heading = 'Per-Segment Comparison' if len(tb) > 0 else 'Per-Phase Comparison'
        ax_t.text(0.0, 1.0, heading, transform=ax_t.transAxes,
                  fontsize=14, fontweight='bold', va='top')
        # Confine the table to the lower portion so it sits below the heading.
        table = ax_t.table(cellText=rows, colLabels=col_labels, cellLoc='center',
                           bbox=[0.0, 0.0, 1.0, 0.82])
        table.auto_set_font_size(False); table.set_fontsize(12)
        for c in range(len(col_labels)):
            cell = table[0, c]; cell.set_facecolor(BLUE); cell.set_text_props(color='white', fontweight='bold')
        # Tint the Timebar row so it's visually distinct from the pan/zoom phases.
        if len(tb) > 0:
            tb_row = len(rows)  # header is row 0, data rows 1..len(rows)
            for c in range(len(col_labels)):
                table[tb_row, c].set_facecolor('#06A77D')
                table[tb_row, c].set_text_props(color='white', fontweight='bold')
    else:
        ax_t.text(0.5, 0.5, 'Single-phase test — see detail pages for the full timeline.',
                  ha='center', va='center', transform=ax_t.transAxes, fontsize=12, style='italic')

    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)
    print("   ✓ Summary page created")


def load_config(csv_file):
    """Load the run's config snapshot (written next to the CSV by the test)."""
    cfg_path = os.path.splitext(csv_file)[0] + '_config.json'
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️  Could not read config snapshot ({cfg_path}): {e}")
    return None


def _card_label(card_id):
    """'StormCells' -> 'Storm Cells', 'SigmetsTwc' -> 'Sigmets Twc' (keeps runs
    of capitals like 'AIRMETs' / 'NHC' together)."""
    return re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', str(card_id))


def _layer_label(card_id):
    """Layers-tab label. Layers with a model picker use their app name from
    layer-models.json ('TemperatureFod' -> 'Temperature'), since the id's model
    suffix would contradict the model actually shown next to it."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'layer-models.json')) as f:
            entry = (json.load(f).get('layers') or {}).get(card_id)
        if entry and entry.get('name'):
            return entry['name']
    except Exception:
        pass
    return _card_label(card_id)


def create_config_page(config, pdf):
    """Page: which desk / layers / phases were active and on what hardware."""
    print("🧾 Creating Test Configuration page...")
    fig = plt.figure(figsize=(11, 8.5))
    fig.suptitle('Test Configuration', fontsize=16, fontweight='bold', y=0.975)
    ax = fig.add_axes([0.06, 0.03, 0.90, 0.90]); ax.axis('off')

    if not config:
        ax.text(0.5, 0.5, 'No config snapshot found for this run.',
                ha='center', va='center', fontsize=12, color='#777')
        pdf.savefig(fig, bbox_inches='tight'); plt.close(fig)
        return

    overlays_on = [_card_label(k) for k, v in (config.get('overlays') or {}).items() if v]
    phases = config.get('phases') or []
    tb = config.get('timebar') or {}
    env = config.get('_runEnvironment', {}) or {}
    sysinfo = env.get('system', {}) or {}
    disp = env.get('display', {}) or {}

    applied = config.get('_appliedModels') or {}

    def model_text(step, requested):
        """' · model ECMWF' — the model the run actually used, flagged when it
        differs from the one asked for (not offered / could not confirm)."""
        res = applied.get(step) or {}
        if not requested and not res:
            return ''
        used = res.get('applied')
        if requested and res and used != requested:
            got = used or 'not set'
            return f" · model {got} (asked for {requested} — not applied)"
        return f" · model {used or requested}"

    y = [0.95]  # mutable so the helpers can advance it

    def header(txt):
        y[0] -= 0.012
        ax.text(0.00, y[0], txt, transform=ax.transAxes, fontsize=12.5, fontweight='bold',
                color='#1a1a1a', va='top')
        y[0] -= 0.040

    def body(txt, color='#222'):
        for seg in textwrap.wrap(txt, width=115) or ['—']:
            ax.text(0.02, y[0], seg, transform=ax.transAxes, fontsize=10.5, color=color, va='top')
            y[0] -= 0.029
        y[0] -= 0.006

    # Run
    header('Run')
    body(f"App: {config.get('url', '—')}")
    body(f"Desk: {config.get('desk') or 'None (baseline)'}")
    dur_ms = config.get('phaseDuration', 0) or 0
    body(f"Phase duration: {dur_ms / 60000:.0f} min per phase")
    if tb.get('enabled'):
        n = tb.get('phase') or 1
        p = phases[n - 1] if 0 < n <= len(phases) else {}
        mode = f"{p.get('projection', '?')} / {p.get('style', '?')}"
        layer = tb.get('layer') or config.get('layer') or 'none'
        tb_model = tb.get('model') if tb.get('layer') else config.get('model')
        body(f"Timebar test: Phase {n} — {mode}, layer {_layer_label(layer)}{model_text('timebar', tb_model)}  (static over US)")
    else:
        body("Timebar test: Off")

    # Machine & display
    header('Machine & display')
    if sysinfo:
        body(f"OS: {sysinfo.get('os', '?')} ({sysinfo.get('arch', '?')})   ·   "
             f"CPU: {sysinfo.get('cpuModel', '?')} ({sysinfo.get('cpuCores', '?')} cores)   ·   "
             f"RAM: {sysinfo.get('totalMemoryGB', '?')} GB"
             + (f"   ·   Host: {sysinfo.get('hostname')}" if sysinfo.get('hostname') else ""))
    if disp and disp.get('screenWidth'):
        sw, sh = disp.get('screenWidth'), disp.get('screenHeight')
        dpr = disp.get('devicePixelRatio') or 1
        phys = f" → {int(sw * dpr)}×{int(sh * dpr)} physical" if dpr and dpr != 1 else ""
        hz = disp.get('refreshRateHz')
        refresh = f"   ·   {hz} Hz (max ~{hz} FPS)" if hz else ""
        body(f"Monitor: {sw}×{sh} CSS px @ {dpr}x{phys}   ·   {disp.get('colorDepth', '?')}-bit color{refresh}")
    vp = env.get('viewport', {}) or {}
    body(f"Browser: {env.get('browser', '?')}   ·   Test viewport: "
         f"{vp.get('width', '?')}×{vp.get('height', '?')}")
    if not env:
        body('Machine/display specs not captured for this run.')

    # Phases
    header('Phases')
    enabled = [(i, p) for i, p in enumerate(phases) if p.get('enabled')]
    for i, p in enabled:
        body(f"• Phase {i + 1}: {p.get('projection', '?')} / {p.get('style', '?')}")
    if not enabled:
        body('No phases enabled.')

    # Layers
    header('Layer (Layers tab)')
    body((_layer_label(config['layer']) + model_text('layer', config.get('model'))) if config.get('layer') else 'None')

    header(f'Overlays ON ({len(overlays_on)})')
    body(', '.join(overlays_on) if overlays_on else 'None')

    pdf.savefig(fig, bbox_inches='tight'); plt.close(fig)


def main():
    if len(sys.argv) != 2:
        print("❌ Usage: python3 visualize_metrics.py <csv_file>")
        print("\nExample:")
        print("    python3 visualize_metrics.py performance_metrics_2026-05-27_13-23-07_UTC.csv")
        sys.exit(1)
    
    csv_file = sys.argv[1]
    
    if not os.path.exists(csv_file):
        print(f"❌ Error: File '{csv_file}' not found")
        sys.exit(1)
    
    try:
        # Load data with phase detection
        df, phase_markers = load_data_with_phases(csv_file)

        # If the run collected no valid metric rows (e.g. it failed during setup,
        # leaving only an ERROR row that gets filtered out), there's nothing to
        # chart — averaging empty/non-numeric columns would crash. Report cleanly.
        if df.empty or df['Browser_Memory_Used'].notna().sum() == 0:
            print("⚠️  No valid metric data in this run — the test likely failed before "
                  "collecting metrics.")
            print("   Check the run's CSV / console_errors file for the failure (look for the "
                  "ERROR row).")
            return

        # Load parallel console-errors CSV (companion file produced by drop_black_performance_test.js)
        errors_file = csv_file.replace('performance_metrics_', 'console_errors_')
        errors_df = load_errors(errors_file)
        config = load_config(csv_file)
        total_duration = float(df['Elapsed_Seconds'].max()) if len(df) > 0 else 0

        # Create output filename
        base_name = os.path.splitext(csv_file)[0]
        output_file = f"{base_name}_analysis.pdf"

        print("="*60)
        print("📊 GENERATING COMPLETE PERFORMANCE ANALYSIS")
        print("="*60)
        print(f"Output: {output_file}\n")

        # Create PDF with all pages
        with PdfPages(output_file) as pdf:
            # Executive summary (always first — the quick-glance page)
            create_summary_page(df, phase_markers, errors_df, total_duration, pdf)

            # Test configuration — which desk/layers/phases were active this run
            create_config_page(config, pdf)

            # Standard performance pages
            create_memory_page(df, pdf)
            create_cpu_page(df, pdf)
            create_fps_page(df, pdf)
            create_memory_growth_rate(df, pdf)

            # Phase comparison pages - only if phases exist
            if len(phase_markers) > 0:
                create_phase_comparison(df, phase_markers, pdf)
                create_phase_overlay(df, phase_markers, pdf)
                create_combined_timeline(df, pdf)

            # FPS broken out by interaction type (pan-only / zoom-only / mixed)
            create_fps_by_interaction_page(df, phase_markers, pdf)

            # Dedicated Timebar segment page (only if this run had a Timebar test).
            # Its samples still count toward the overall metrics on the summary page.
            timebar_page = create_timebar_page(df, pdf)

            # Console errors page (always last)
            create_errors_frequency_page(errors_df, pdf)

        print("="*60)
        print(f"✅ Analysis PDF created: {output_file}")
        print("="*60)

        print("\n📖 This PDF contains:")
        print("   • Page 1: Executive Summary (quick glance)")
        print("   • Page 2: Test Configuration (layers enabled)")
        print("   • Page 3: Memory Performance Analysis")
        print("   • Page 3: CPU Performance Analysis")
        print("   • Page 4: FPS Performance Analysis")
        print("   • Page 5: Cumulative Memory Growth Analysis")
        page_count = 5

        if len(phase_markers) > 0:
            print("   • Page 6: Phase-by-Phase Comparison")
            print("   • Page 7: Phase Overlay Comparison")
            print("   • Page 8: Combined Performance Timeline")
            page_count = 8

        page_count += 1
        print(f"   • Page {page_count}: FPS by Interaction Type")
        if timebar_page:
            page_count += 1
            print(f"   • Page {page_count}: Timebar Segment Analysis")
        page_count += 1
        print(f"   • Page {page_count}: Console Errors by Frequency")

        print(f"\n📄 Total pages: {page_count}\n")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
