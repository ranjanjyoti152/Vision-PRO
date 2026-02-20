"""
GPU detection and management utilities.
"""
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class GPUInfo:
    """GPU information container."""
    id: int
    name: str
    memory_total_mb: int
    memory_used_mb: int
    memory_free_mb: int
    gpu_utilization: float
    memory_utilization: float
    temperature: float


def is_gpu_available() -> bool:
    """Check if NVIDIA GPU is available."""
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        pynvml.nvmlShutdown()
        return count > 0
    except Exception:
        return False


def get_gpu_count() -> int:
    """Get number of available GPUs."""
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        pynvml.nvmlShutdown()
        return count
    except Exception:
        return 0


def get_gpu_info() -> list[GPUInfo]:
    """Get detailed info for all GPUs."""
    gpus = []
    try:
        import pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()

        for i in range(count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8")

            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)

            try:
                temp = pynvml.nvmlDeviceGetTemperature(
                    handle, pynvml.NVML_TEMPERATURE_GPU
                )
            except Exception:
                temp = 0.0

            gpus.append(GPUInfo(
                id=i,
                name=name,
                memory_total_mb=round(mem_info.total / 1024 / 1024),
                memory_used_mb=round(mem_info.used / 1024 / 1024),
                memory_free_mb=round(mem_info.free / 1024 / 1024),
                gpu_utilization=util.gpu,
                memory_utilization=util.memory,
                temperature=temp,
            ))

        pynvml.nvmlShutdown()
    except Exception as e:
        logger.warning(f"Could not read GPU info: {e}")

    return gpus


def get_torch_device() -> str:
    """Get the best available torch device string."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"
